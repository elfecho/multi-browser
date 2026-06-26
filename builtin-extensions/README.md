# 内置插件

把你的浏览器插件放在这个目录下，每个插件一个文件夹。

## 如何添加 Violentmonkey（暴力猴 - 开源的油猴替代）

### 方法一：从 Chrome 应用店安装（推荐）

1. 在你的 Chrome 浏览器中访问：
   https://chrome.google.com/webstore/detail/violent-monkey/jinjaccalgkegednnccohejagnlnfdag

2. 点击"添加至 Chrome"

3. 在 Chrome 地址栏输入：`chrome://extensions/`

4. 开启右上角的"开发者模式"

5. 找到 Violentmonkey，复制它的 ID（类似：`jinjaccalgkegednnccohejagnlnfdag`）

6. 在电脑上找到这个文件夹：
   ```
   C:\Users\你的用户名\AppData\Local\Google\Chrome\User Data\Default\Extensions\jinjaccalgkegednnccohejagnlnfdag\
   ```

7. 复制最新的版本文件夹（类似 `2.x.x_0`）到本目录的 `violentmonkey/` 文件夹下

8. 确保目录结构是：
   ```
   builtin-extensions/
   ├── README.md
   └── violentmonkey/          # 插件文件夹
       ├── manifest.json
       ├── ...
   ```

### 方法二：从 GitHub Releases 下载

1. 访问：https://github.com/violentmonkey/violentmonkey/releases

2. 下载最新的 `violentmonkey-v2.x.x-chrome.zip` 文件

3. 解压到本目录的 `violentmonkey/` 文件夹下

## 目录结构示例

```
builtin-extensions/
├── README.md
└── violentmonkey/          # 插件文件夹
    ├── manifest.json
    ├── ...
```
