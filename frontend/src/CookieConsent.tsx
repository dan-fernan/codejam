import { useEffect, useState } from 'react'
import { C, FONT_UI } from './theme'

const STORAGE_KEY = 'cookieConsent'

function CookieConsent() {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        try {
            if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
        } catch {
            // storage blocked — skip banner
        }
    }, [])

    async function handleAllow() {
        try {
            await fetch('http://localhost:8080/session', { method: 'POST', credentials: 'include'})
        } finally {
            try { localStorage.setItem(STORAGE_KEY, 'allowed') } catch { /* ignore */ }
            setVisible(false)
        }
    }

    function handleDecline() {
        try { localStorage.setItem(STORAGE_KEY, 'declined') } catch { /* ignore */}
        setVisible(false)
    }

    if (!visible) return null

    return (
        <div
            style={{
                position: 'fixed',
                top: 16,
                left: 16,
                maxWidth: 340,
                background: C.paper,
                color: C.ink,
                borderRadius: 12,
                padding: '14px 16px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                fontFamily: FONT_UI,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                zIndex: 1000,
            }}
        >
            <p style={{ margin: 0, fontSize: 13}}>
                We use one cookie to remember your rooms across visits. Not required to use CodeJam.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end'}}>
                <button
                    onClick={handleDecline}
                    style={{
                        fontFamily: FONT_UI, fontSize: 13, fontWeight: 700,
                        color: C.ink, background: 'transparent', border: 'none',
                        cursor: 'pointer', padding: '6px 10px'
                    }}
                >
                    Decline
                </button>
                <button
                      onClick={handleAllow}
                      style={{
                          fontFamily: FONT_UI, fontSize: 13, fontWeight: 700,
                          color: C.white, background: C.jam, border: 'none',
                          borderRadius: 999, cursor: 'pointer', padding: '6px 16px',
                      }}
                  >
                      Allow
                  </button>
            </div>
        </div>
    )
}

export default CookieConsent