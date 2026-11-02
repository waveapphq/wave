/**
 * Not Found Page - REQ-5.2.1.2 Client-side routing with navigation history
 *
 * 404 page component displayed when a route is not found.
 * Provides navigation options to return to a valid page.
 */

import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

const containerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
  padding: '24px',
  textAlign: 'center',
}

const statusStyle: React.CSSProperties = {
  fontSize: '72px',
  fontWeight: 'bold',
  color: '#dc2626',
  marginBottom: '16px',
}

const headingStyle: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  marginBottom: '8px',
  color: '#1f2937',
}

const messageStyle: React.CSSProperties = {
  color: '#6b7280',
  marginBottom: '8px',
}

const pathStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  backgroundColor: '#f3f4f6',
  padding: '4px 8px',
  borderRadius: '4px',
  color: '#374151',
  marginBottom: '24px',
}

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  alignItems: 'center',
}

const linkStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#3b82f6',
  color: 'white',
  textDecoration: 'none',
  borderRadius: '4px',
}

const backButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  backgroundColor: '#6b7280',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
}

/**
 * 404 Not Found page component
 */
export function NotFoundPage(): ReactNode {
  const location = useLocation()
  const navigate = useNavigate()

  const handleGoBack = () => {
    navigate(-1)
  }

  return (
    <div style={containerStyle}>
      <div style={statusStyle}>404</div>
      <h1 style={headingStyle}>Page Not Found</h1>
      <p style={messageStyle}>The page you're looking for doesn't exist.</p>
      <div style={pathStyle}>{location.pathname}</div>
      <div style={buttonContainerStyle}>
        <Link to="/dashboard" style={linkStyle}>
          Go to Dashboard
        </Link>
        <button type="button" style={backButtonStyle} onClick={handleGoBack}>
          Go Back
        </button>
      </div>
    </div>
  )
}
