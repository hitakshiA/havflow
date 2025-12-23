import { useState, useEffect, useRef } from 'react'
import initWasm, { WasmOrderbook } from 'kraken-wasm'

export default function App() {
  const [status, setStatus] = useState('Initializing...')
  const [imbalance, setImbalance] = useState(0)
  const [imbalanceHistory, setImbalanceHistory] = useState([])
  const [bids, setBids] = useState([])
  const [asks, setAsks] = useState([])
  const [stats, setStats] = useState({ bidVolume: 0, askVolume: 0, spread: 0 })
  const bookRef = useRef(null)
  const wsRef = useRef(null)

  useEffect(() => {
    let mounted = true

    async function init() {
      await initWasm()
      if (!mounted) return

      bookRef.current = new WasmOrderbook()
      setStatus('Connecting...')

      const ws = new WebSocket('wss://ws.kraken.com/v2')
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('Connected')
        ws.send(JSON.stringify({
          method: 'subscribe',
          params: { channel: 'book', symbol: ['BTC/USD'], depth: 25 }
        }))
      }

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data)
        if (data.channel === 'book' && data.data) {
          bookRef.current.apply_message(event.data)

          const topBids = bookRef.current.get_top_bids(25)
          const topAsks = bookRef.current.get_top_asks(25)
          const spread = bookRef.current.get_spread()

          setBids(topBids)
          setAsks(topAsks)

          // Calculate volumes
          const bidVolume = topBids.reduce((sum, [_, qty]) => sum + qty, 0)
          const askVolume = topAsks.reduce((sum, [_, qty]) => sum + qty, 0)

          setStats({ bidVolume, askVolume, spread })

          // Calculate imbalance: (bid - ask) / (bid + ask)
          const total = bidVolume + askVolume
          if (total > 0) {
            const imb = (bidVolume - askVolume) / total
            setImbalance(imb)
            setImbalanceHistory(prev => [...prev.slice(-59), imb])
          }
        }
      }

      ws.onclose = () => setStatus('Disconnected')
      ws.onerror = () => setStatus('Error')
    }

    init()
    return () => {
      mounted = false
      wsRef.current?.close()
    }
  }, [])

  const gaugePosition = ((imbalance + 1) / 2) * 100 // Convert -1..1 to 0..100

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>HAVFLOW</h1>
        <div style={styles.symbol}>BTC/USD</div>
        <div style={styles.statusBar}>
          <span style={{
            ...styles.statusDot,
            background: status === 'Connected' ? '#00FF88' : '#FF4444'
          }} />
          <span>{status}</span>
        </div>
      </header>

      <div style={styles.content}>
        <div style={styles.gaugeContainer}>
          <h2 style={styles.sectionTitle}>ORDER FLOW IMBALANCE</h2>

          <div style={styles.gaugeWrapper}>
            <div style={styles.gaugeLabels}>
              <span style={{ color: '#FF4444' }}>SELL</span>
              <span style={{ color: '#00FF88' }}>BUY</span>
            </div>

            <div style={styles.gaugeTrack}>
              <div style={{
                ...styles.gaugeNeedle,
                left: `${gaugePosition}%`,
              }} />
              <div style={{
                ...styles.gaugeFill,
                background: imbalance >= 0
                  ? `linear-gradient(to right, #2a2e38 50%, #00FF88 50%, #00FF88 ${50 + (imbalance * 50)}%, #2a2e38 ${50 + (imbalance * 50)}%)`
                  : `linear-gradient(to right, #2a2e38 ${50 + (imbalance * 50)}%, #FF4444 ${50 + (imbalance * 50)}%, #FF4444 50%, #2a2e38 50%)`,
              }} />
            </div>

            <div style={styles.gaugeScale}>
              <span>-1.0</span>
              <span>0</span>
              <span>+1.0</span>
            </div>
          </div>

          <div style={styles.imbalanceValue}>
            <span style={{ color: imbalance >= 0 ? '#00FF88' : '#FF4444' }}>
              {imbalance >= 0 ? '+' : ''}{imbalance.toFixed(3)}
            </span>
            <span style={styles.pressureLabel}>
              {imbalance >= 0.1 ? 'BUY PRESSURE' : imbalance <= -0.1 ? 'SELL PRESSURE' : 'BALANCED'}
            </span>
          </div>
        </div>

        <div style={styles.historyContainer}>
          <h2 style={styles.sectionTitle}>IMBALANCE HISTORY (60s)</h2>
          <div style={styles.sparkline}>
            {imbalanceHistory.map((val, i) => (
              <div
                key={i}
                style={{
                  ...styles.sparkBar,
                  height: `${Math.abs(val) * 100}%`,
                  background: val >= 0 ? '#00FF88' : '#FF4444',
                  bottom: val >= 0 ? '50%' : 'auto',
                  top: val >= 0 ? 'auto' : '50%',
                }}
              />
            ))}
          </div>
          <div style={styles.sparkLabels}>
            <span>-1.0</span>
            <span style={styles.zeroLine}>0</span>
            <span>+1.0</span>
          </div>
        </div>

        <div style={styles.volumeStats}>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>BID VOLUME</div>
            <div style={{ ...styles.statValue, color: '#00FF88' }}>
              {stats.bidVolume.toFixed(4)} BTC
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>ASK VOLUME</div>
            <div style={{ ...styles.statValue, color: '#FF4444' }}>
              {stats.askVolume.toFixed(4)} BTC
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statLabel}>SPREAD</div>
            <div style={{ ...styles.statValue, color: '#FFD700' }}>
              ${stats.spread?.toFixed(2) || '---'}
            </div>
          </div>
        </div>

        <div style={styles.depthBars}>
          <div style={styles.depthSide}>
            <h3 style={{ ...styles.depthTitle, color: '#00FF88' }}>BIDS</h3>
            {bids.slice(0, 10).map(([price, qty], i) => {
              const maxQty = Math.max(...bids.slice(0, 10).map(b => b[1]))
              return (
                <div key={i} style={styles.depthRow}>
                  <div style={{
                    ...styles.depthBar,
                    width: `${(qty / maxQty) * 100}%`,
                    background: 'linear-gradient(to right, transparent, #00FF8844)',
                  }} />
                  <span style={styles.depthQty}>{qty.toFixed(4)}</span>
                  <span style={styles.depthPrice}>${price.toLocaleString()}</span>
                </div>
              )
            })}
          </div>
          <div style={styles.depthSide}>
            <h3 style={{ ...styles.depthTitle, color: '#FF4444' }}>ASKS</h3>
            {asks.slice(0, 10).map(([price, qty], i) => {
              const maxQty = Math.max(...asks.slice(0, 10).map(a => a[1]))
              return (
                <div key={i} style={styles.depthRow}>
                  <div style={{
                    ...styles.depthBar,
                    width: `${(qty / maxQty) * 100}%`,
                    background: 'linear-gradient(to right, transparent, #FF444444)',
                  }} />
                  <span style={styles.depthQty}>{qty.toFixed(4)}</span>
                  <span style={styles.depthPrice}>${price.toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0a0e14',
    color: '#b3b1ad',
    fontFamily: "'SF Mono', monospace",
    padding: '20px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    borderBottom: '1px solid #2a2e38',
    paddingBottom: '15px',
  },
  title: {
    color: '#00D9FF',
    fontSize: '24px',
    fontWeight: 'bold',
    letterSpacing: '4px',
  },
  symbol: {
    color: '#FFD700',
    fontSize: '18px',
    fontWeight: 'bold',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '25px',
  },
  gaugeContainer: {
    background: '#12171f',
    borderRadius: '8px',
    padding: '30px',
    border: '1px solid #2a2e38',
  },
  sectionTitle: {
    color: '#00D9FF',
    fontSize: '12px',
    letterSpacing: '2px',
    marginBottom: '20px',
    textAlign: 'center',
  },
  gaugeWrapper: {
    maxWidth: '600px',
    margin: '0 auto',
  },
  gaugeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '10px',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  gaugeTrack: {
    height: '40px',
    background: '#2a2e38',
    borderRadius: '20px',
    position: 'relative',
    overflow: 'hidden',
  },
  gaugeFill: {
    position: 'absolute',
    inset: 0,
    borderRadius: '20px',
  },
  gaugeNeedle: {
    position: 'absolute',
    top: '-5px',
    width: '4px',
    height: '50px',
    background: '#FFD700',
    borderRadius: '2px',
    transform: 'translateX(-50%)',
    boxShadow: '0 0 10px #FFD700',
    zIndex: 10,
  },
  gaugeScale: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '10px',
    fontSize: '12px',
    color: '#666',
  },
  imbalanceValue: {
    textAlign: 'center',
    marginTop: '20px',
    fontSize: '32px',
    fontWeight: 'bold',
  },
  pressureLabel: {
    display: 'block',
    fontSize: '12px',
    color: '#666',
    letterSpacing: '2px',
    marginTop: '5px',
  },
  historyContainer: {
    background: '#12171f',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2a2e38',
  },
  sparkline: {
    height: '100px',
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    position: 'relative',
  },
  sparkBar: {
    flex: 1,
    minWidth: '4px',
    position: 'absolute',
    borderRadius: '2px',
  },
  sparkLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#666',
    marginTop: '5px',
  },
  zeroLine: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
  },
  volumeStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '15px',
  },
  statCard: {
    background: '#12171f',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2a2e38',
    textAlign: 'center',
  },
  statLabel: {
    color: '#666',
    fontSize: '11px',
    letterSpacing: '1px',
    marginBottom: '8px',
  },
  statValue: {
    fontSize: '18px',
    fontWeight: 'bold',
  },
  depthBars: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '20px',
  },
  depthSide: {
    background: '#12171f',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2a2e38',
  },
  depthTitle: {
    fontSize: '12px',
    letterSpacing: '2px',
    marginBottom: '15px',
  },
  depthRow: {
    position: 'relative',
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 0',
    fontSize: '12px',
  },
  depthBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  depthQty: {
    position: 'relative',
    zIndex: 1,
  },
  depthPrice: {
    position: 'relative',
    zIndex: 1,
    color: '#FFD700',
  },
}
