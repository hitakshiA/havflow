import { useState, useEffect, useRef, useCallback } from 'react'
import initWasm, { WasmOrderbook } from '../wasm/kraken_wasm.js'

const SYMBOL = 'BTC/USD'
const DEPTH = 25

export default function App() {
  const [status, setStatus] = useState('Initializing...')
  const [sdkReady, setSdkReady] = useState(false)
  const [imbalance, setImbalance] = useState(0)
  const [imbalanceHistory, setImbalanceHistory] = useState([])
  const [bids, setBids] = useState([])
  const [asks, setAsks] = useState([])
  const [stats, setStats] = useState({ bidVolume: 0, askVolume: 0, spread: 0, midPrice: 0 })

  const bookRef = useRef(null)
  const wsRef = useRef(null)
  const messageQueueRef = useRef([])
  const processingRef = useRef(false)

  // Process messages sequentially to avoid WASM borrow conflicts
  const processNextMessage = useCallback(() => {
    if (processingRef.current) return
    if (messageQueueRef.current.length === 0) return

    processingRef.current = true
    const data = messageQueueRef.current.shift()

    try {
      const book = bookRef.current
      if (!book) {
        processingRef.current = false
        if (messageQueueRef.current.length > 0) setTimeout(processNextMessage, 0)
        return
      }

      const result = book.apply_and_get(data, DEPTH)

      if (result && (result.msg_type === 'update' || result.msg_type === 'snapshot')) {
        const topBids = result.bids || []
        const topAsks = result.asks || []

        setBids(topBids)
        setAsks(topAsks)

        // Calculate volumes (SDK returns {price, qty} objects)
        const bidVolume = topBids.reduce((sum, b) => sum + (b.qty || b[1] || 0), 0)
        const askVolume = topAsks.reduce((sum, a) => sum + (a.qty || a[1] || 0), 0)

        setStats({
          bidVolume,
          askVolume,
          spread: result.spread || 0,
          midPrice: result.mid_price || 0
        })

        // Calculate imbalance: (bid - ask) / (bid + ask)
        const total = bidVolume + askVolume
        if (total > 0) {
          const imb = (bidVolume - askVolume) / total
          setImbalance(imb)
          setImbalanceHistory(prev => [...prev.slice(-59), imb])
        }
      }
    } catch (e) {
      // Silently ignore errors
    } finally {
      processingRef.current = false
      if (messageQueueRef.current.length > 0) {
        setTimeout(processNextMessage, 0)
      }
    }
  }, [])

  const queueMessage = useCallback((data) => {
    messageQueueRef.current.push(data)
    // Prevent queue from growing too large
    if (messageQueueRef.current.length > 200) {
      messageQueueRef.current = messageQueueRef.current.slice(-100)
    }
    processNextMessage()
  }, [processNextMessage])

  useEffect(() => {
    let mounted = true

    async function init() {
      console.log('[HAVFLOW] Initializing Havklo SDK...')
      await initWasm()
      if (!mounted) return

      console.log('[HAVFLOW] SDK ready')
      setSdkReady(true)

      // Create orderbook with correct precision for BTC/USD
      const book = WasmOrderbook.with_depth(SYMBOL, DEPTH)
      book.set_precision(1, 8) // BTC precision
      bookRef.current = book

      setStatus('Connecting...')
      const ws = new WebSocket('wss://ws.kraken.com/v2')
      wsRef.current = ws

      ws.onopen = () => {
        if (!mounted) return
        console.log('[HAVFLOW] WebSocket connected')
        setStatus('Connected')
        ws.send(JSON.stringify({
          method: 'subscribe',
          params: { channel: 'book', symbol: [SYMBOL], depth: DEPTH }
        }))
      }

      ws.onmessage = (event) => {
        if (!mounted) return
        try {
          const msg = JSON.parse(event.data)
          if (msg.channel === 'book' && msg.data?.[0]?.symbol === SYMBOL) {
            queueMessage(event.data)
          }
        } catch (e) {}
      }

      ws.onclose = () => {
        if (!mounted) return
        setStatus('Disconnected')
      }
      ws.onerror = () => setStatus('Error')
    }

    init()
    return () => {
      mounted = false
      wsRef.current?.close()
      try { bookRef.current?.free() } catch (e) {}
    }
  }, [queueMessage])

  const gaugePosition = ((imbalance + 1) / 2) * 100 // Convert -1..1 to 0..100

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={styles.title}>HAVFLOW</h1>
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            background: sdkReady ? '#00D9FF' : '#666',
            color: '#0a0e14',
            borderRadius: '4px',
            fontWeight: 'bold'
          }}>
            SDK
          </span>
        </div>
        <div style={styles.symbol}>{SYMBOL}</div>
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

          {stats.midPrice > 0 && (
            <div style={styles.midPrice}>
              Mid Price: <span style={{ color: '#FFD700' }}>${stats.midPrice.toLocaleString()}</span>
            </div>
          )}
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
                  left: `${(i / 60) * 100}%`,
                  width: `${100 / 60}%`,
                }}
              />
            ))}
            <div style={styles.zeroLineHorizontal} />
          </div>
          <div style={styles.sparkLabels}>
            <span>-1.0</span>
            <span style={styles.zeroLabel}>0</span>
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
            <h3 style={{ ...styles.depthTitle, color: '#00FF88' }}>BIDS (Top 10)</h3>
            {bids.slice(0, 10).map((bid, i) => {
              const price = bid.price || bid[0] || 0
              const qty = bid.qty || bid[1] || 0
              const maxQty = Math.max(...bids.slice(0, 10).map(b => b.qty || b[1] || 0), 0.001)
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
            <h3 style={{ ...styles.depthTitle, color: '#FF4444' }}>ASKS (Top 10)</h3>
            {asks.slice(0, 10).map((ask, i) => {
              const price = ask.price || ask[0] || 0
              const qty = ask.qty || ask[1] || 0
              const maxQty = Math.max(...asks.slice(0, 10).map(a => a.qty || a[1] || 0), 0.001)
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

      <footer style={styles.footer}>
        Powered by <span style={{ color: '#00D9FF' }}>Havklo SDK</span> | Real-time data from Kraken WebSocket v2
      </footer>
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
    display: 'flex',
    flexDirection: 'column',
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
    margin: 0,
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
    flex: 1,
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
    marginTop: 0,
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
  midPrice: {
    textAlign: 'center',
    marginTop: '15px',
    fontSize: '14px',
    color: '#666',
  },
  historyContainer: {
    background: '#12171f',
    borderRadius: '8px',
    padding: '20px',
    border: '1px solid #2a2e38',
  },
  sparkline: {
    height: '100px',
    position: 'relative',
    background: '#1a1f29',
    borderRadius: '4px',
  },
  sparkBar: {
    position: 'absolute',
    borderRadius: '2px',
  },
  zeroLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: '1px',
    background: '#3a3e48',
  },
  sparkLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#666',
    marginTop: '5px',
    position: 'relative',
  },
  zeroLabel: {
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
    marginTop: 0,
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
  footer: {
    textAlign: 'center',
    color: '#666',
    fontSize: '12px',
    marginTop: '20px',
    paddingTop: '15px',
    borderTop: '1px solid #2a2e38',
  },
}
