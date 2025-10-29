
/**
 * Metrics.js
 *
 * Client-side endpoint metrics collector.
 *
 * This module can be embedded in client-side JavaScript to gather usage
 * and latency data for HTTP endpoints. For each endpoint it records:
 * - totalCalls
 * - successfulCalls
 * - failedCalls
 * - timedOutCalls
 * - responseTimes (capped at MAX_SAMPLES)
 * - lastUpdated (timestamp)
 *
 * Typical integration:
 * - On client startup call loadMetrics() (e.g. in main.js) so persisted
 *   metrics are restored across sessions.
 * - During usage call:
 *     recordEndpointEvent(url, responseTime, 'success') when a request returns 200
 *     recordEndpointEvent(url, responseTime, 'failed')  when a request returns an error (e.g. 4xx/5xx)
 *     recordEndpointEvent(url, responseTime, 'timeout') when a request times out
 * - Optionally call saveMetrics() periodically (the module also persists
 *   automatically every 10 calls per endpoint).
 *
 * Devtools / console helpers:
 * - getEndpointSnapshot(endpointKey): descriptive stats for a single endpoint
 * - getAllEndpointSnapshots(): descriptive stats for all endpoints
 * - saveEndpointMetrics(): persist current metrics to localStorage
 * - loadEndpointMetrics(): load persisted metrics from localStorage
 * - clearEndpointMetrics(): reset metrics in memory (and optionally persist)
 * - getEndpointHistogram(endpointKey, binSize, maxMs): returns histogram data
 * - plotEndpointHistogram(endpointKey): generates and downloads a JPEG histogram via Plotly
 * - plotHistogramAllEndpoints(): runs plotEndpointHistogram for all known endpoints
 */
 
import Plotly from 'plotly.js-dist-min'

const STORAGE_KEY = 'retry_endpoint_metrics_v1'
const MAX_SAMPLES = 2000
const TIMEOUT = 2000

// in-memory store: { [endpointKey]: { totalCalls, successfulCalls, failedCalls, timedOutCalls, responseTimes: [], lastUpdated } }
const endpointMetrics = Object.create(null)

const safeGet = (k) => {
  try { return localStorage.getItem(k) } catch (e) { return null }
}
const safeSet = (k, v) => {
  try { localStorage.setItem(k, v) } catch (e) { /* ignore */ }
}

/**
 * Derive a stable endpoint key from a raw URL.
 *
 * The function prefers URL query params named LAYERS / layers / layer; if none
 * are present it uses the last non-empty path segment or the hostname as a fallback.
 *
 * @param {string} rawUrl - The input URL (absolute or relative).
 * @returns {string} A key representing the endpoint (may be the original rawUrl on parse failure).
 */
export const getEndpointKeyFromUrl = (rawUrl) => {
  try {
    const base = (typeof location !== 'undefined' && location.origin) ? location.origin : undefined
    const u = new URL(rawUrl, base)
    const l = u.searchParams.get('LAYERS') || u.searchParams.get('layers') || u.searchParams.get('layer')
    if (l) return l
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.length ? parts[parts.length - 1] : u.hostname
  } catch (e) {
    return rawUrl
  }
}
/**
 * Either creates and returns or directly 
 * returns an object for storing responsetimes and metrics for 
 * an endpoint
 * @param {string} key 
 * @returns {object}
 */
const ensureEndpoint = (key) => {
  if (!endpointMetrics[key]) {
    endpointMetrics[key] = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timedOutCalls: 0,
      responseTimes: [],
      lastUpdated: Date.now()
    }
  }
  return endpointMetrics[key]
}
/**
 * Appends a reponsetime to an array
 * and shifts it if the maximum sample size has been reached
 * @param {array} arr 
 * @param {number} v 
 */
const pushSample = (arr, v) => {
  arr.push(v)
  if (arr.length > MAX_SAMPLES) arr.shift()
}
/**
 * Record an event (call) for an endpoint.
 *
 * Updates in-memory metrics for the endpoint identified by rawUrl.
 * - increments TotalCalls by 1
 * - increments successfulCalls | failedCalls | timedoutCalls based on status argument
 * - appends provided responsetime to responseTimes attribute if exists. Otherwise, it changes nothing
 * - Updates the endpoint's lastUpdated timestamp to the current time (Date.now()).
 * - Persists metrics to localStorage every 10 calls for that endpoint.
 *  
 * In this way, the user decides whether to include timeouts or not in the histograms
 *
 * @param {string} rawUrl - The request URL (used to derive endpoint key).
 * @param {number|null} [responseTime=null] - Response time in milliseconds or null.
 * @param {'success'|'failed'|'timeout'} [status='success'] - Outcome of the request.
 * @returns {void}
 */
export const recordEndpointEvent = (rawUrl, responseTime = null, status = 'success') => {
  const key = getEndpointKeyFromUrl(rawUrl)
  const em = ensureEndpoint(key)

  em.totalCalls = em.totalCalls + 1
  if (status === 'success') {
    em.successfulCalls += 1
  } else if (status === 'failed') {
    em.failedCalls += 1
  } else if (status === 'timeout') {
    em.timedOutCalls += 1   
  }
  if (typeof responseTime === 'number' && Number.isFinite(responseTime)) pushSample(em.responseTimes, responseTime)

  em.lastUpdated = Date.now()

  // inexpensive persistence heuristic
  if (em.totalCalls % 10 === 0) saveMetrics()
}
/**
 * Compute the p-th percentile of a numeric array using linear interpolation.
 *
 * Notes:
 * - Returns null if `arr` is falsy or empty.
 * - Operates on a shallow sorted copy so the input array is not mutated.
 * - Expects `p` in the closed interval [0, 1]. `p = 0` yields the minimum, `p = 1` yields the maximum.
 * - Uses index = (n - 1) * p to identify the percentile value. If the index is integer the value at that index is returned;
 *   otherwise the result is linearly interpolated between floor(index) and ceil(index).
 *
 * @param {number[]} arr - Array of numeric samples (non-numeric values may produce NaN).
 * @param {number} p - Percentile to compute, a number between 0 and 1 inclusive.
 * @returns {number|null} The percentile value (same units as samples) or null when input is empty.
 */
const computePercentile = (arr, p) => {
  if (!arr || arr.length === 0) return null
  const a = arr.slice().sort((x,y)=>x-y)
  const idx = (a.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return a[lo]
  return a[lo] + (a[hi] - a[lo]) * (idx - lo)
}
/**
 * Compute descriptive statistics for an endpoint snapshot.
 *
 * Returned object includes:
 * - totalCalls, successfulCalls, failedCalls, timedOutCalls
 * - successRate, failureRate, timeoutRate (fractions)
 * - samples (number of latency samples), mean, p5, p20, p80, p95
 * - lastUpdated (timestamp)
 *
 * @param {object} em - Endpoint metrics object (internal shape).
 * @returns {object} Statistics for the endpoint.
 */
const computeStatsForEndpoint = (em) => {
  const rt = em.responseTimes || []
  const count = rt.length
  const sum = count ? rt.reduce((s,v)=>s+v,0) : 0
  const mean = count ? sum / count : null
  return {
    totalCalls: em.totalCalls,
    successfulCalls: em.successfulCalls,
    failedCalls: em.failedCalls,
    timedOutCalls: em.timedOutCalls,
    successRate: em.totalCalls ? em.successfulCalls / em.totalCalls : 0,
    failureRate: em.totalCalls ? em.failedCalls / em.totalCalls : 0,
    timeoutRate: em.totalCalls ? em.timedOutCalls / em.totalCalls : 0,
    samples: count,
    mean,
    p5: computePercentile(rt, 0.05),
    p20: computePercentile(rt, 0.20),
    p80: computePercentile(rt, 0.80),
    p95: computePercentile(rt, 0.95),
    lastUpdated: em.lastUpdated
  }
}

/**
 * Return a computed snapshot (descriptive stats) for a single endpoint key.
 * Internally, it uses computeStatsForEndpoint
 * @param {string} endpointKey - The endpoint key as returned by getEndpointKeyFromUrl.
 * @returns {object|null} Stats object or null if endpoint is unknown.
 */
export const getEndpointSnapshot = (endpointKey) => {
  const em = endpointMetrics[endpointKey]
  if (!em) return null
  return computeStatsForEndpoint(em)
}

/**
 * Build a histogram of response times for an endpoint.
 *
 * @param {string} endpointKey - Endpoint key to build histogram for.
 * @param {number} [binSize=25] - Width of each histogram bin in milliseconds.
 * @param {number|null} [maxMs=null] - Optional maximum ms to include (extends bins to this value).
 * @returns {object} Histogram result:
 *   { binSize, binEdges, counts, bins, samples, maxValue }
 *   - binEdges: array of bin starting edges
 *   - counts: array of counts per bin
 *   - bins: array of { rangeStart, rangeEnd, count }
 *   - samples: number of samples considered
 *   - maxValue: maximum value used to compute bins
 */
export const getEndpointHistogram = (endpointKey, binSize = 25, maxMs = null) => {
  const em = endpointMetrics[endpointKey]
  if (!em || !Array.isArray(em.responseTimes) || em.responseTimes.length === 0) {
    return { binSize, binEdges: [], counts: [], bins: [], samples: 0, maxValue: 0 }
  }

  const arr = em.responseTimes.slice()
  const observedMax = Math.max(...arr)
  const maxValue = (typeof maxMs === 'number' && maxMs > 0) ? Math.max(maxMs, observedMax) : observedMax
  const numBins = Math.max(1, Math.ceil((maxValue + 1) / binSize))
  const counts = new Array(numBins).fill(0)

  for (let v of arr) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const idx = Math.min(Math.floor(v / binSize), numBins - 1)
    counts[idx]++
  }

  const binEdges = counts.map((_, i) => i * binSize)
  const bins = counts.map((count, i) => ({
    rangeStart: i * binSize,
    rangeEnd: i * binSize + (binSize - 1),
    count
  }))

  return { binSize, binEdges, counts, bins, samples: arr.length, maxValue }
}
/**
 * Render and download a JPEG histogram for an endpoint using Plotly.
 *
 * This will create a hidden DOM node, render the chart, convert it to a
 * JPEG data URL and trigger a download named "<endpointKey>-hist.jpg".
 *
 * @param {string} endpointKey - Endpoint key to plot.
 * @param {number} [binSize=25] - Histogram bin size in ms.
 * @returns {Promise<object>} Object containing { ok: true, filename, hist, stats }.
 */
export const plotEndpointHistogram = async (endpointKey, binSize = 25) => {
  const hist = getEndpointHistogram(endpointKey, binSize)
  const labels = hist.binEdges.map(s => `${s}-${s + binSize - 1}ms`)
  const data = [{ x: labels, y: hist.counts, type: 'bar', marker: { color: 'hsl(198, 100%, 22%)' } }]

  // build stats text from endpoint snapshot so we can render under the chart (as an annotation)
  const em = endpointMetrics[endpointKey] || { responseTimes: [], totalCalls:0, successfulCalls:0, failedCalls:0, timedOutCalls:0, lastUpdated:null }
  const stats = computeStatsForEndpoint(em)
  const statsLines = [
    `Samples: ${stats.samples}`,
    `Mean: ${stats.mean !== null ? Math.round(stats.mean) + ' ms' : 'n/a'}`,
    `p5: ${stats.p5 !== null ? Math.round(stats.p5) + ' ms' : 'n/a'}`,
    `p20: ${stats.p20 !== null ? Math.round(stats.p20) + ' ms' : 'n/a'}`,
    `p80: ${stats.p80 !== null ? Math.round(stats.p80) + ' ms' : 'n/a'}`,
    `p95: ${stats.p95 !== null ? Math.round(stats.p95) + ' ms' : 'n/a'}`,
    `Success rate: ${Math.round((stats.successRate || 0) * 100)}%`,
    `Failure rate: ${Math.round((stats.failureRate || 0) * 100)}%`,
    `Timeout rate: ${Math.round((stats.timeoutRate || 0) * 100)}%`
  ]
  const statsText = statsLines.join('<br>')

  const layout = {
    title: {
      text: `${endpointKey} response time distribution`,
      x: 0.5,
      xanchor: 'center',
      y: 0.98,
      font: { size: 16, color: 'hsl(0, 0%, 0%)' }
    },
    xaxis: {
      title: { text: 'Response time (ms)', font: { size: 12, color: 'hsl(0, 0%, 0%)' } },
      tickangle: -45,
      automargin: true
    },
    yaxis: {
      title: { text: 'Frequency', font: { size: 12, color: 'hsl(0, 0%, 0%)' } }
    },
    bargap: 0.05,
    // increase bottom margin for annotation space
    width: 1200,
    height: 600,
    annotations: [
      {
        text: statsText,
        xref: 'paper',
        x: 1,
        xanchor: 'right',
        yref: 'paper',
        y: 0.7,
        yanchor: 'bottom',
        showarrow: false,
        align: 'left',
        font: { size: 11 },
        bgcolor: 'hsl(60, 7%, 90%)',
        bordercolor: 'hsl(0, 0%, 0%)',
        borderwidth: 1,
        pad: { l: 8, r: 8, t: 6, b: 6 }
      }
    ]
  }
  const el = document.createElement('div')
  el.style.width = `${layout.width}px`
  el.style.height = `${layout.height}px`
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)

  await Plotly.newPlot(el, data, layout)
  const dataUrl = await Plotly.toImage(el, { format: 'jpeg', width: layout.width, height: layout.height, quality: 0.8 })

  const fname = `${endpointKey.replace(/[^a-z0-9_\-]/gi, '_')}-hist.jpg`
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fname
  document.body.appendChild(a)
  a.click()
  a.remove()

  try { Plotly.purge(el) } catch (e) { /* ignore */ }
  el.remove()

  return { ok: true, filename: fname, hist, stats }
}

/**
 * Plot histograms for all known endpoints sequentially.
 * Runs plotEndPointHistogram internally, that saves each histogram 
 * as a jpeg to /downloads.
 *
 * Options:
 * - binSize (default 25)
 *
 * @param {number} 
 * @returns {Promise<Array>} Array of results per endpoint:
 *   { endpoint, ok: true, result } or { endpoint, ok: false, error }
 */
export const plotHistogramAllEndpoints = async (
  binSize = 25) => {
  const keys = Object.keys(endpointMetrics)
  const results = []

  for (const k of keys) {
    try {
      // call the single-endpoint exporter (await so downloads happen sequentially)
      const res = await plotEndpointHistogram(k, binSize)
      results.push({ endpoint: k, ok: true, result: res })
    } catch (err) {
      results.push({ endpoint: k, ok: false, error: err })
    }
  }

  return results
}
/**
 * Return snapshots for all known endpoints.
 * Internally calls computeStatsForEndpoint sequentially
 * on each endpoint.
 *
 * @returns {Array<{endpoint: string, stats: object}>} Array of endpoint snapshots.
 */
export const getAllEndpointSnapshots = () => {
  return Object.keys(endpointMetrics).map(k => ({ endpoint: k, stats: computeStatsForEndpoint(endpointMetrics[k]) }))
}
/**
 * Persist current in-memory metrics to localStorage.
 *
 * Uses a safe wrapper around localStorage to avoid exceptions in restricted environments.
 *
 * @returns {void}
 */
export const saveMetrics = () => {
  try {
    const payload = JSON.stringify(endpointMetrics)
    safeSet(STORAGE_KEY, payload)
  } catch (e) { /* ignore */ }
}

/**
 * Load persisted metrics from localStorage into memory.
 *
 * Existing in-memory metrics will be replaced with the parsed payload.
 * Response time arrays are trimmed to MAX_SAMPLES.
 *
 * @returns {void}
 */
export const loadMetrics = () => {
  try {
    const raw = safeGet(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return
    Object.keys(parsed).forEach(k => {
      endpointMetrics[k] = parsed[k]
      if (!Array.isArray(endpointMetrics[k].responseTimes)) endpointMetrics[k].responseTimes = []
      if (endpointMetrics[k].responseTimes.length > MAX_SAMPLES) {
        endpointMetrics[k].responseTimes = endpointMetrics[k].responseTimes.slice(-MAX_SAMPLES)
      }
    })
  } catch (e) { /* ignore */ }
}

/**
 * Clear all in-memory metrics. Optionally persist the cleared state.
 *
 * @param {boolean} [persist=false] - When true write the cleared state to localStorage.
 * @returns {void}
 */
export const clearMetrics = (persist = false) => {
  Object.keys(endpointMetrics).forEach(k => delete endpointMetrics[k])
  if (persist) saveMetrics()
}

// dev helpers
if (typeof window !== 'undefined') {
  window.getEndpointSnapshot = getEndpointSnapshot
  window.getAllEndpointSnapshots = getAllEndpointSnapshots
  window.saveEndpointMetrics = saveMetrics
  window.loadEndpointMetrics = loadMetrics
  window.clearEndpointMetrics = clearMetrics
  window.getEndpointHistogram = getEndpointHistogram
  window.plotEndpointHistogram = plotEndpointHistogram
  window.plotHistogramAllEndpoints = plotHistogramAllEndpoints
}

export default {
  recordEndpointEvent,
  getEndpointSnapshot,
  getAllEndpointSnapshots,
  saveMetrics,
  loadMetrics,
  clearMetrics,
  getEndpointKeyFromUrl,
  getEndpointHistogram,
  plotEndpointHistogram,
  plotHistogramAllEndpoints
}