import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  Empty,
  Input,
  Layout,
  List,
  message,
  Popconfirm,
  Space,
  Typography
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  LeftOutlined,
  RightOutlined,
  ReloadOutlined,
  GlobalOutlined
} from '@ant-design/icons';
import 'antd/dist/reset.css';
import './styles.css';

const { Sider, Content } = Layout;
const { Text, Title } = Typography;

function App() {
  const [accounts, setAccounts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) || null,
    [accounts, selectedId]
  );

  async function refresh() {
    const nextAccounts = await window.multiBrowser.accounts.list();
    setAccounts(nextAccounts);
    if (!selectedId && nextAccounts.length > 0) {
      setSelectedId(nextAccounts[0].id);
    }
  }

  useEffect(() => {
    refresh().catch((error) => message.error(error.message));
  }, []);

  // 创建新账号
  async function createAccount() {
    try {
      // 使用 Electron 的弹窗
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

  async function deleteAccount(accountId) {
    setBusy(true);
    try {
      await window.multiBrowser.accounts.delete(accountId);
      if (selectedId === accountId) {
        if (accounts.length > 1) {
          const otherAccount = accounts.find(a => a.id !== accountId);
          if (otherAccount) {
            setSelectedId(otherAccount.id);
          }
        } else {
          setSelectedId(null);
        }
      }
      await refresh();
      message.success('账号已删除');
    } catch (error) {
      message.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  // 切换账号并打开浏览器
  async function switchToAccount(accountId) {
    setSelectedId(accountId);
    await launchBrowser(accountId);
  }

  async function launchBrowser(accountId) {
    setBusy(true);
    try {
      await window.multiBrowser.browser.launch(accountId);
      try {
        const url = await window.multiBrowser.browserView.getUrl();
        setCurrentUrl(url);
      } catch (e) {
        const account = accounts.find(a => a.id === accountId);
        setCurrentUrl(account?.environment.homepage || 'https://www.dola.com/chat/create-image');
      }
    } catch (error) {
      message.error(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function goBack() {
    try {
      await window.multiBrowser.browserView.goBack();
    } catch (error) {
      message.error(error.message);
    }
  }

  async function goForward() {
    try {
      await window.multiBrowser.browserView.goForward();
    } catch (error) {
      message.error(error.message);
    }
  }

  async function reload() {
    try {
      await window.multiBrowser.browserView.reload();
    } catch (error) {
      message.error(error.message);
    }
  }

  async function handleUrlSubmit(e) {
    e.preventDefault();
    if (!currentUrl) return;
    try {
      await window.multiBrowser.browserView.loadUrl(currentUrl);
    } catch (error) {
      message.error(error.message);
    }
  }

  // 初始化时自动打开浏览器
  useEffect(() => {
    if (accounts.length > 0 && selectedId) {
      launchBrowser(selectedId);
    }
  }, [accounts]);

  return (
    <Layout className="app-shell">
      <Sider className="sidebar" width={320} theme="light">
        <div className="sidebar-header">
          <Title level={4}>多账号隔离浏览器</Title>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={createAccount}
          >
            新建
          </Button>
        </div>

        <List
          className="account-list"
          dataSource={accounts}
          locale={{ emptyText: <Empty description="暂无账号" /> }}
          renderItem={(account) => {
            const homepage = account.environment.homepage || 'https://www.dola.com/chat/create-image';
            return (
              <List.Item
                className={account.id === selectedId ? 'account-row selected' : 'account-row'}
                style={{ padding: '12px 16px', cursor: 'pointer' }}
                onClick={() => switchToAccount(account.id)}
              >
                <div style={{ flex: 1, marginRight: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text strong style={{ fontSize: '15px' }}>{account.name}</Text>
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
                        style={{ padding: '4px 8px', marginLeft: 8 }}
                      >
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                  <Text type="secondary" ellipsis style={{ display: 'block', marginTop: 4, fontSize: '13px' }}>
                    {homepage}
                  </Text>
                </div>
              </List.Item>
            );
          }}
        />
      </Sider>

      <Layout className="main-area">
        <div className="browser-controls">
          <Space>
            <Button icon={<LeftOutlined />} onClick={goBack}>后退</Button>
            <Button icon={<RightOutlined />} onClick={goForward}>前进</Button>
            <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
          </Space>
          <Input
            className="url-input"
            value={currentUrl}
            onChange={(e) => setCurrentUrl(e.target.value)}
            onPressEnter={handleUrlSubmit}
            placeholder="输入网址..."
            prefix={<GlobalOutlined />}
          />
        </div>
        <Content className="content" />
      </Layout>
    </Layout>
  );
}

createRoot(document.getElementById('root')).render(<App />);
