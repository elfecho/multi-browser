const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs-extra')
const https = require('https')
const http = require('http')
const os = require('os')

class BrowserManager {
  constructor(accountRepository, downloadHistoryRepository) {
    this.accountRepository = accountRepository
    this.downloadHistoryRepository = downloadHistoryRepository
    this.sessions = new Map()
    this.downloadDir = path.join(process.cwd(), 'downloads')
    this.extensionPath = path.join(process.cwd(), 'builtin-extensions', 'doubao-international')
    this.tempDir = path.join(os.tmpdir(), 'dola-video-gen')
    fs.ensureDirSync(this.downloadDir)
    fs.ensureDirSync(this.tempDir)
  }

  listRunning() {
    return Array.from(this.sessions.keys())
  }

  isRunning(accountId) {
    return this.sessions.has(accountId)
  }

  async activate(accountId) {
    const context = this.sessions.get(accountId)
    if (context) {
      try {
        const pages = context.pages()
        for (const page of pages) {
          await page.bringToFront()
          break
        }
        return { accountId, status: 'activated' }
      } catch (e) {
        console.error('Failed to activate browser:', e)
        return { accountId, status: 'failed', error: e.message }
      }
    } else {
      return this.launch(accountId)
    }
  }

  async launch(accountId) {
    if (this.sessions.has(accountId)) {
      return this.activate(accountId)
    }

    const account = await this.accountRepository.get(accountId)
    if (!account) throw new Error('Account not found')

    const launchOptions = this.createLaunchOptions(account)

    const context = await chromium.launchPersistentContext(account.profile_path, launchOptions)
    context.on('close', () => {
      this.sessions.delete(accountId)
    })

    this.setupNetworkInterception(context, accountId)

    this.sessions.set(accountId, context)
    await this.accountRepository.markOpened(accountId)

    const pages = context.pages()
    let page
    if (pages.length === 0) {
      page = await context.newPage()
    } else {
      page = pages[0]
    }
    
    const homepage = account.environment.homepage || 'https://www.dola.com/chat'
    try {
      await page.goto(homepage, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch (e) {
      console.log('Page load timeout, continuing:', e.message)
    }

    return { accountId, status: 'running' }
  }

  makeNoWatermarkUrl(videoUrl) {
    if (!videoUrl) return videoUrl
    let url = videoUrl
    // 策略1: 替换 lr= 参数（doubao.com CDN）
    if (url.includes('lr=')) {
      url = url.replace(/lr=[^&]+/g, 'lr=video_gen_no_watermark')
    }
    // 策略2: 替换/移除 watermark 相关参数
    if (url.includes('watermark')) {
      // 尝试将 watermark=1 改为 watermark=0
      url = url.replace(/watermark=1/g, 'watermark=0')
      // 尝试去掉 ~tplv-*watermark* 后缀（字节CDN的图片/视频处理标记）
      url = url.replace(/~tplv-[^.?&]*watermark[^.?&]*/gi, '')
    }
    // 策略3: 去掉 logo 参数
    if (url.includes('logo=')) {
      url = url.replace(/[&?]logo=[^&]*/g, '')
    }
    return url
  }

  setupNetworkInterception(context, accountId) {
    context.on('response', async (response) => {
      try {
        const url = response.url()
        const contentType = response.headers()['content-type'] || ''
        
        // 1. 检测 get_play_info 接口（这是获取视频的关键接口）
        if (url.includes('/samantha/media/get_play_info') && contentType.includes('application/json')) {
          console.log('[BrowserManager] 检测到 get_play_info 响应')
          const text = await response.text()
          try {
            const json = JSON.parse(text)
            await this.extractNoWatermarkVideo(accountId, json)
          } catch (e) {
            console.error('[BrowserManager] 解析 get_play_info 失败:', e.message)
          }
          return
        }
        
        // 2. 检测其他可能包含视频信息的接口
        if (contentType.includes('application/json') && 
            (url.includes('/samantha') || url.includes('dola.com') || url.includes('doubao.com'))) {
          const text = await response.text()
          try {
            const json = JSON.parse(text)
            await this.detectVideoInResponse(accountId, json, url)
          } catch (e) {
            // 忽略解析错误
          }
        }
      } catch (e) {
        // 忽略网络错误
      }
    })
  }

  async extractNoWatermarkVideo(accountId, json) {
    if (!json || json.code !== 0 || !json.data) {
      return
    }

    let videoInfo = null

    // 优先使用 original_media_info（通常是原始无水印版本，和插件一样）
    const om = json.data.original_media_info
    if (om && om.main_url) {
      console.log('[BrowserManager] 使用 original_media_info.main_url（真正无水印）')
      videoInfo = {
        mainUrl: om.main_url,
        width: om.width,
        height: om.height
      }
    } else {
      // 备选：从 play_infos 中选择最高画质
      const pi = json.data.play_infos && json.data.play_infos[0] || json.data.play_info
      if (pi && pi.main) {
        videoInfo = {
          mainUrl: pi.main,
          width: pi.width,
          height: pi.height
        }
      }
    }

    if (videoInfo) {
      // 应用去水印处理
      const noWatermarkUrl = this.makeNoWatermarkUrl(videoInfo.mainUrl)
      console.log('[BrowserManager] 去水印处理前:', videoInfo.mainUrl.substring(0, 100), '...')
      console.log('[BrowserManager] 去水印处理后:', noWatermarkUrl.substring(0, 100), '...')

      // 从响应中提取 vid
      let vid = json.data.vid || json.data.video_id || json.data.videoId
      if (!vid) {
        // 如果没有 vid，生成一个临时 id
        vid = 'video_' + Date.now()
      }

      console.log('[BrowserManager] 准备下载无水印视频, vid:', vid)
      await this.processVideoDownload(accountId, vid, noWatermarkUrl, videoInfo.width, videoInfo.height)
    }
  }

  async detectVideoInResponse(accountId, json, url) {
    if (!json || typeof json !== 'object') return
    
    const findVideos = (obj) => {
      if (!obj || typeof obj !== 'object') return null
      
      if (Array.isArray(obj)) {
        for (const item of obj) {
          const result = findVideos(item)
          if (result) return result
        }
        return null
      }
      
      // 查找 vid/video_id 等常见字段
      const vid = obj.vid || obj.video_id || obj.videoId
      if (vid && typeof vid === 'string' && vid.length > 5) {
        // 同时查找是否有 url
        const videoUrl = obj.main_url || obj.play_url || obj.download_url || 
                        obj.url || obj.original_url || obj.no_watermark_url ||
                        // 嵌套结构
                        (obj.original_media_info && obj.original_media_info.main_url) ||
                        (obj.play_info && obj.play_info.main) ||
                        (obj.media_info && obj.media_info.main_url)
        if (videoUrl && typeof videoUrl === 'string' && videoUrl.startsWith('http')) {
          return {
            vid: vid, 
            videoUrl: videoUrl, 
            width: obj.width || obj.video_width, 
            height: obj.height || obj.video_height
          }
        }
      }
      
      // 递归查找子对象
      for (const key in obj) {
        if (obj[key] && typeof obj[key] === 'object') {
          const result = findVideos(obj[key])
          if (result) return result
        }
      }
      return null
    }
    
    const videoInfo = findVideos(json)
    if (videoInfo) {
      console.log('[BrowserManager] 在响应检测到视频')
      // 应用去水印处理
      const noWatermarkUrl = this.makeNoWatermarkUrl(videoInfo.videoUrl)
      await this.processVideoDownload(accountId, videoInfo.vid, noWatermarkUrl, videoInfo.width, videoInfo.height)
    }
  }

  async processVideoDownload(accountId, vid, videoUrl, width, height) {
    if (!vid || !videoUrl) return
    
    // 检查是否已下载过
    const existing = await this.downloadHistoryRepository.getByVideoId(accountId, vid)
    if (existing) {
      console.log('[BrowserManager] 视频已下载过，跳过 (vid:', vid, ')')
      return
    }
    
    console.log('[BrowserManager] 开始处理新视频下载 (vid:', vid, ')')
    
    // 生成文件名
    const filename = this.generateFilename(videoUrl, width, height)
    const filePath = path.join(this.downloadDir, filename)
    
    // 创建下载记录
    const record = await this.downloadHistoryRepository.create({
      account_id: accountId,
      video_id: vid,
      video_url: videoUrl,
      filename: filename,
      file_path: filePath,
      width: width,
      height: height,
      status: 'downloading'
    })
    
    // 开始下载
    try {
      await this.downloadFile(videoUrl, filePath)
      
      // 更新为完成
      await this.downloadHistoryRepository.updateStatus(record.id, 'completed', filePath)
      console.log('[BrowserManager] 视频下载完成:', filename)
      
      // 发送事件通知
      this.emitDownloadEvent(accountId, {
        type: 'completed',
        video_id: vid,
        filename: filename,
        file_path: filePath
      })
    } catch (error) {
      // 失败更新状态
      await this.downloadHistoryRepository.updateStatus(record.id, 'failed')
      console.error('[BrowserManager] 视频下载失败:', error.message)
      
      // 发送事件通知
      this.emitDownloadEvent(accountId, {
        type: 'failed',
        video_id: vid,
        error: error.message
      })
    }
  }

  downloadFile(url, filepath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      
      protocol.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return this.downloadFile(response.headers.location, filepath).then(resolve).catch(reject)
        }
        
        if (response.statusCode !== 200) {
          reject(new Error('HTTP ' + response.statusCode))
          return
        }
        
        const fileStream = fs.createWriteStream(filepath)
        response.pipe(fileStream)
        
        fileStream.on('finish', () => {
          fileStream.close()
          resolve()
        })
        
        fileStream.on('error', (err) => {
          fs.unlink(filepath, () => {})
          reject(err)
        })
      }).on('error', (err) => {
        reject(err)
      })
    })
  }

  generateFilename(url, width, height) {
    const timestamp = Date.now()
    const random = Math.random().toString(36).substring(2, 8)
    
    let ext = '.mp4'
    const match = url.match(/\.(mp4|webm|mov|avi|mkv|flv)(\?|$)/i)
    if (match) {
      ext = '.' + match[1].toLowerCase()
    }
    
    const sizePart = (width && height) ? '_' + width + 'x' + height : ''
    
    return 'dola_video' + sizePart + '_' + timestamp + '_' + random + ext
  }

  emitDownloadEvent(accountId, event) {
    console.log('[DownloadEvent] 账号', accountId, ':', event)
  }

  async getDownloads(accountId) {
    return this.downloadHistoryRepository.getByAccount(accountId)
  }

  async close(accountId) {
    const context = this.sessions.get(accountId)
    if (!context) return { accountId, status: 'stopped' }

    await context.close()
    this.sessions.delete(accountId)
    return { accountId, status: 'stopped' }
  }

  async closeAll() {
    const closes = Array.from(this.sessions.keys()).map((accountId) => this.close(accountId))
    await Promise.allSettled(closes)
  }

  createLaunchOptions(account) {
    const env = account.environment
    return {
      headless: false,
      userAgent: env.userAgent,
      locale: env.locale,
      timezoneId: env.timezoneId,
      viewport: env.viewport,
      colorScheme: env.colorScheme || 'light',
      args: [
        '--window-size=' + env.viewport.width + ',' + env.viewport.height,
        '--disable-blink-features=AutomationControlled',
        '--load-extension=' + this.extensionPath,
        '--disable-extensions-except=' + this.extensionPath,
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--allow-running-insecure-content'
      ]
    }
  }

  async saveImageFile(file) {
    if (!file) return null
    
    const fileName = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9) + '.png'
    const filePath = path.join(this.tempDir, fileName)
    
    if (file.path && fs.existsSync(file.path)) {
      await fs.copy(file.path, filePath)
    } else if (file.name && (file.buffer || file.arrayBuffer)) {
      const buffer = file.buffer || Buffer.from(await file.arrayBuffer())
      await fs.writeFile(filePath, buffer)
    }
    
    return filePath
  }

  async sendPrompt(accountId, prompt, imagePath) {
    const context = this.sessions.get(accountId)
    if (!context) {
      throw new Error('浏览器未启动，请先启动浏览器')
    }

    const pages = context.pages()
    let page = pages.find((p) => {
      const u = p.url()
      return u.includes('dola.com/chat') || u.includes('dola.com')
    })

    if (!page) {
      page = await context.newPage()
    }

    const targetUrl = 'https://www.dola.com/chat'
    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
      await page.waitForTimeout(1500)
    } catch (e) {
      console.log('Page navigation may timeout, continuing:', e.message)
    }

    try {
      await page.evaluate((text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).catch(() => {})
        }
        
        const createNotice = () => {
          const existing = document.getElementById('_dola_helper')
          if (existing) existing.remove()
          
          const notice = document.createElement('div')
          notice.id = '_dola_helper'
          notice.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
                                 'background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);' +
                                 'color:#fff;padding:16px 24px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.2);' +
                                 'z-index:999999;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;max-width:500px;'
          
          notice.innerHTML = '<div style="font-weight:600;margin-bottom:8px;font-size:15px;">' +
                             '⚡ 提示词已就绪!</div>' +
                             '<div style="opacity:0.95;">提示词已复制到剪贴板，请在输入框按 ' +
                             '<strong>Ctrl+V</strong> 粘贴</div>' +
                             '<div style="margin-top:12px;text-align:right;">' +
                             '<button onclick="this.parentElement.parentElement.remove()" ' +
                             'style="background:rgba(255,255,255,0.2);border:none;color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px;">' +
                             '知道了</button></div>'
          
          document.body.appendChild(notice)
          
          setTimeout(() => {
            if (notice.parentElement) {
              notice.style.transition = 'opacity 0.3s'
              notice.style.opacity = '0'
              setTimeout(() => notice.remove(), 300)
            }
          }, 8000)
        }
        
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', createNotice)
        } else {
          createNotice()
        }
      }, prompt)
      
      return { success: true, message: '提示词已复制到剪贴板' }
      
    } catch (e) {
      console.error('Failed to send prompt:', e)
      return { success: true, message: '已打开页面' }
    }
  }
}

module.exports = BrowserManager
