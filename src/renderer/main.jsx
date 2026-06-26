import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Empty, Layout, List, message, Popconfirm, Typography, Tag, notification } from 'antd';
import { DeleteOutlined, PlusOutlined, FolderOutlined, DownloadOutlined, PlayCircleOutlined } from '@ant-design/icons';
import 'antd/dist/reset.css';
import './styles.css';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

function App() {
  const [accounts, setAccounts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [runningAccounts, setRunningAccounts] = useState(new Set());
  const [downloads, setDownloads] = useState(new Map());
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [api, contextHolder] = notification.useNotification();

  // 刷新数据
  const refresh = useCallback(async () => {
    try {
      const nextAccounts = await window.multiBrowser.accounts.list();
      setAccounts(nextAccounts);
      
      // 检查每个账号的运行状态
      const running = new Set();
      for (const account of nextAccounts) {
        try {
          const result = await window.multiBrowser.browser.isRunning(account.id);
          if (result.running) {
            running.add(account.id);
          }
          // 获取账号的下载历史
          const accountDownloads = await window.multiBrowser.downloadHistory.getByAccount(account.id);
          setDownloads(prev => {
            const newMap = new Map(prev);
            newMap.set(account.id, accountDownloads);
            return newMap;
          });
        } catch {
          // 忽略错误
        }
      }
      setRunningAccounts(running);
    } catch (e) {
      console.error('Refresh failed:', e);
    }
  }, []);

  useEffect(() => {
    refresh().catch((error) => message.error(error.message));
    
    // 定期刷新运行状态
    const interval = setInterval(() => {
      refresh().catch(() => {});
    }, 2000);
    
    return () => clearInterval(interval);
  }, [refresh]);

  // 监听下载事件
  useEffect(() => {
    const unsubscribe = window.multiBrowser.onDownloadEvent((event) => {
      console.log('下载事件:', event);
      
      if (event.type === 'completed') {
        api.success({
          message: '下载完成',
          description: '视频已下载: ' + event.filename,
          icon: <DownloadOutlined style={{ color: '#10b981' }} />,
          placement: 'bottomRight'
        });
      } else if (event.type === 'failed') {
        api.error({
          message: '下载失败',
          description: event.error,
          placement: 'bottomRight'
        });
      }
      
      // 刷新下载记录
      refresh().catch(() => {});
    });
    
    return unsubscribe;
  }, [api, refresh]);

  // 选择账号（自动启动或激活浏览器）
  const selectAccount = useCallback(async (accountId) => {
    setSelectedAccount(accountId);
    
    // 如果账号未运行启动浏览器
    try {
      setBusy(true);
      await window.multiBrowser.browser.activate(accountId);
      message.success('浏览器已启动/激活');
    } catch (e) {
      console.error('启动失败:', e);
    } finally {
      setBusy(false);
    }
  }, []);

  // 创建新账号
  async function createAccount() {
    try {
      const result = await window.multiBrowser.showCreateAccountDialog();
      if (result && result.name) {
        await window.multiBrowser.accounts.create({ name: result.name });
        message.success('账号已创建');
        await refresh();
      }
    } catch (error) {
      message.error(error.message);
    }
  }

  // 删除账号
  async function deleteAccount(accountId) {
    setBusy(true);
    try {
      await window.multiBrowser.browser.close(accountId).catch(() => {});
      await window.multiBrowser.accounts.delete(accountId);
      if (selectedAccount === accountId) {
        setSelectedAccount(null);
      }
      await refresh();
      message.success('账号已删除');
    } catch (error) {
      message.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  // 打开下载目录
  async function openDownloadDir() {
    try {
      await window.multiBrowser.downloads.openDir();
    } catch (error) {
      message.error('无法打开下载目录');
    }
  }

  const getAccountDownloads = useCallback((accountId) => {
    return downloads.get(accountId) || [];
  }, [downloads]);

  return (
    <Layout className="app-shell" style={{ minHeight: '100vh', height: '100vh', overflow: 'hidden' }}>
      {contextHolder}
      <Sider className="sidebar" width={320} theme="light">
        <div className="sidebar-header">
          <Title level={4}>Dola 视频生成器</Title>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              icon={<FolderOutlined />}
              onClick={openDownloadDir}
              title="打开下载目录"
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={createAccount}
            >
              新建账号
            </Button>
          </div>
        </div>

        <List
          className="account-list"
          dataSource={accounts}
          locale={{ emptyText: <Empty description="暂无账号" /> }}
          renderItem={(account) => {
            const isRunning = runningAccounts.has(account.id);
            const accountDownloads = getAccountDownloads(account.id);
            const completedDownloads = accountDownloads.filter(d => d.status === 'completed').length;
            const isSelected = selectedAccount === account.id;
            
            return (
              <List.Item
                className={'account-row ' + (isSelected ? 'selected' : '')}
                style={{ padding: '12px 16px', cursor: 'pointer' }}
                onClick={() => selectAccount(account.id)}
                actions={[
                  <Popconfirm
                    title="删除账号"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={(e) => {
                      e.stopPropagation();
                      deleteAccount(account.id);
                    }}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      onClick={(e) => e.stopPropagation()}
                      style={{ padding: '4px 8px' }}
                    >
                      <DeleteOutlined />
                    </Button>
                  </Popconfirm>
                ]}
              >
                <div style={{ flex: 1, marginRight: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <Text strong style={{ fontSize: '15px' }}>{account.name}</Text>
                      {isRunning && <Tag color="green">运行中</Tag>}
                      {completedDownloads > 0 && (
                        <Tag color="blue" icon={<DownloadOutlined />}>
                          {completedDownloads}
                        </Tag>
                      )}
                    </div>
                  </div>
                  <Text type="secondary" ellipsis style={{ display: 'block', marginTop: '4px', fontSize: '13px' }}>
                    点击启动/切换到该账号的浏览器
                  </Text>
                  {/* 显示下载状态 */}
                  {accountDownloads.length > 0 && (
                    <div style={{ marginTop: '8px', fontSize: '12px' }}>
                      {accountDownloads.slice(-3).map((download, idx) => (
                        <div key={idx} style={{ 
                          color: download.status === 'completed' ? '#10b981' : 
                                 download.status === 'downloading' ? '#1677ff' : '#ef4444' 
                        }}>
                          {download.status === 'downloading' && '⏳ '}
                          {download.status === 'completed' && '✓ '}
                          {download.status === 'failed' && '✗ '}
                          {download.filename || '下载中...'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </List.Item>
            );
          }}
        />
      </Sider>

      <Layout className="main-area" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Content className="content" style={{ flex: 1, padding: '0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 顶部栏 */}
          <div style={{ 
            padding: '12px 24px', 
            background: '#fff', 
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Title level={4} style={{ margin: 0, fontSize: '18px' }}>🎬 Dola 视频生成器</Title>
              {selectedAccount && (
                <Tag color="blue">
                  已选择: {accounts.find(a => a.id === selectedAccount)?.name}
                </Tag>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button
                icon={<FolderOutlined />}
                onClick={openDownloadDir}
              >
                打开下载目录
              </Button>
            </div>
          </div>

          {/* 主内容区 */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', background: '#f5f7fb', padding: '32px' }}>
            <div style={{ maxWidth: '700px', margin: '0 auto', width: '100%' }}>
              {/* 状态卡 */}
              <div style={{ 
                background: '#fff', 
                borderRadius: '12px', 
                padding: '24px', 
                marginBottom: '24px',
                border: '1px solid #e5e7eb'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ 
                    width: '56px', 
                    height: '56px', 
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <PlayCircleOutlined style={{ fontSize: '24px', color: '#fff' }} />
                  </div>
                  <div>
                    <Title level={4} style={{ margin: 0, fontSize: '18px' }}>
                      {selectedAccount ? (
                        selectedAccount && (
                          <span>浏览器已{runningAccounts.has(selectedAccount) ? '就绪' : '准备就绪'}</span>
                        )
                      ) : '选择左侧账号开始使用'}
                    </Title>
                    <Text style={{ color: '#6b7280', fontSize: '14px' }}>
                      {selectedAccount ? (
                        runningAccounts.has(selectedAccount) 
                          ? '浏览器正在独立窗口中运行' 
                          : '点击账号启动浏览器'
                      ) : '在左侧选择一个账号来开始生成视频'}
                    </Text>
                  </div>
                </div>

                {selectedAccount && (
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <Button 
                      type="primary" 
                      size="large" 
                      onClick={() => selectAccount(selectedAccount)}
                      loading={busy}
                      style={{ flex: 1 }}
                    >
                      {runningAccounts.has(selectedAccount) ? '激活浏览器窗口' : '启动浏览器'}
                    </Button>
                    <Button 
                      size="large" 
                      onClick={openDownloadDir}
                    >
                      打开下载目录
                    </Button>
                  </div>
                )}
              </div>

              {/* 使用说明 */}
              <div style={{ 
                background: '#fff', 
                borderRadius: '12px', 
                padding: '24px',
                border: '1px solid #e5e7eb'
              }}>
                <Title level={5} style={{ marginBottom: '16px', fontSize: '16px' }}>使用说明</Title>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      background: '#eef4ff', 
                      color: '#1677ff',
                      borderRadius: '50%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: '600',
                      fontSize: '14px',
                      flexShrink: 0
                    }}>1</div>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: '4px' }}>选择左侧账号</Text>
                      <Text style={{ color: '#6b7280', fontSize: '13px' }}>
                        点击左侧账号列表中的账号来选择
                      </Text>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      background: '#eef4ff', 
                      color: '#1677ff',
                      borderRadius: '50%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: '600',
                      fontSize: '14px',
                      flexShrink: 0
                    }}>2</div>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: '4px' }}>启动浏览器</Text>
                      <Text style={{ color: '#6b7280', fontSize: '13px' }}>
                        点击"启动浏览器"按钮，在独立窗口中打开浏览器
                      </Text>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      background: '#eef4ff', 
                      color: '#1677ff',
                      borderRadius: '50%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: '600',
                      fontSize: '14px',
                      flexShrink: 0
                    }}>3</div>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: '4px' }}>生成视频</Text>
                      <Text style={{ color: '#6b7280', fontSize: '13px' }}>
                        在浏览器中正常使用 Dola 生成视频
                      </Text>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <div style={{ 
                      width: '28px', 
                      height: '28px', 
                      background: '#eef4ff', 
                      color: '#1677ff',
                      borderRadius: '50%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center',
                      fontWeight: '600',
                      fontSize: '14px',
                      flexShrink: 0
                    }}>4</div>
                    <div>
                      <Text strong style={{ display: 'block', marginBottom: '4px' }}>自动下载</Text>
                      <Text style={{ color: '#6b7280', fontSize: '13px' }}>
                        视频生成完成后，系统会自动检测并下载无水印版本到 downloads 文件夹
                      </Text>
                    </div>
                  </div>
                </div>
              </div>

              {/* 最近下载 */}
              {selectedAccount && getAccountDownloads(selectedAccount).length > 0 && (
                <div style={{ 
                  background: '#fff', 
                  borderRadius: '12px', 
                  padding: '24px',
                  border: '1px solid #e5e7eb',
                  marginTop: '24px'
                }}>
                  <Title level={5} style={{ marginBottom: '16px', fontSize: '16px' }}>
                    最近下载 ({getAccountDownloads(selectedAccount).length})
                  </Title>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {getAccountDownloads(selectedAccount).slice().reverse().map((download, idx) => (
                      <div 
                        key={idx}
                        style={{ 
                          display: 'flex', 
                          justifyContent: 'space-between', 
                          alignItems: 'center',
                          padding: '10px 12px',
                          background: '#f9fafb',
                          borderRadius: '8px',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ 
                            width: '8px', 
                            height: '8px', 
                            borderRadius: '50%',
                            background: download.status === 'completed' ? '#10b981' : 
                                      download.status === 'downloading' ? '#1677ff' : '#ef4444'
                          }} />
                          <Text ellipsis style={{ maxWidth: '400px' }}>{download.filename}</Text>
                        </div>
                        <Tag color={
                          download.status === 'completed' ? 'success' : 
                          download.status === 'downloading' ? 'processing' : 'error'
                        } style={{ margin: 0 }}>
                          {download.status === 'completed' ? '已完成' : 
                           download.status === 'downloading' ? '下载中' : '失败'}
                        </Tag>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

createRoot(document.getElementById('root')).render(<App />);
