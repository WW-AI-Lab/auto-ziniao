import { Layout, Menu, Typography } from 'antd'
import {
  DashboardOutlined,
  PartitionOutlined,
  FieldTimeOutlined,
  HistoryOutlined,
  MessageOutlined,
} from '@ant-design/icons'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Flows from './pages/Flows'
import Schedules from './pages/Schedules'
import Monitoring from './pages/Monitoring'
import Chat from './pages/Chat'

const MENU = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/flows', icon: <PartitionOutlined />, label: '流程管理' },
  { key: '/schedules', icon: <FieldTimeOutlined />, label: '计划任务' },
  { key: '/monitoring', icon: <HistoryOutlined />, label: '运行与自愈' },
  { key: '/chat', icon: <MessageOutlined />, label: 'Agent 对话' },
]

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const selected = MENU.find((m) => location.pathname.startsWith(m.key))?.key ?? '/dashboard'

  return (
    <Layout style={{ height: '100%' }}>
      <Layout.Sider theme="dark" width={200}>
        <div style={{ padding: '16px 12px' }}>
          <Typography.Text strong style={{ color: '#fff', fontSize: 15 }}>
            紫鸟自动化引擎
          </Typography.Text>
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>Web 管理界面</div>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={MENU}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout.Content style={{ overflow: 'auto', background: '#f5f5f5' }}>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/flows/:flowId" element={<Flows />} />
          <Route path="/schedules" element={<Schedules />} />
          <Route path="/monitoring" element={<Monitoring />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Layout.Content>
    </Layout>
  )
}
