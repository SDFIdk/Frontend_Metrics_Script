# Client-Side Metrics Script

A small script to embed in client-side code to gather and perform statistical analysis of http-request response-times.

## Table of contents
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Install](#install)
  - [Usage](#usage)
- [Examples](#examples)
- [License](#license)
- [Contact](#contact)

## Quick Start

### Prerequisites
A Frontend application containing client-side js in a modern browser
that supports:
  - ES Modules (import/export)
  - localStorage
  - DOM api
  - Devtools Console

### Install
Copy metrics.js into your project, then run:
```bash
npm install plotly.js-dist-min
```
to download a browser-friendly plotting library.

The script can be embedded in the following ways:

Example (local file):
```html
<script type="module">
  import metrics from './metrics.js'
  window.metrics = metrics
</script>
```

Example (bundler / npm):
- Add file to your source tree and import:
```javascript
import metrics from './metrics.js'
```

### Usage

In the clientside JS,
include loadMetrics() somewhere in the startupscript of your application, such as a main.js file.

overwrite ```js window.fetch ``` or create a fetch-wrapper, that calls 
  -  recordEndpointEvent(url, responseTime, 'success') when a request returns 200
  -  recordEndpointEvent(url, responseTime, 'failed')  when a request returns an error (e.g. 4xx/5xx)
  -  recordEndpointEvent(url, responseTime, 'timeout') when a request times out

In the browser console, call these functions to interact with the stored data:
- loadMetrics(): Load persisted metrics from localStorage into memory.
- saveMetrics(): Persist current in-memory metrics to localStorage.
- clearMetrics(persist = false): Clear all in-memory metrics; if persist=true, overwrite stored data.
- recordEndpointEvent(rawUrl, responseTime = null, status = 'success'): Record an endpoint call and optional latency. status is 'success' | 'failed' | 'timeout'.
- getEndpointKeyFromUrl(rawUrl): Derive a short stable endpoint key from a URL (prefers LAYERS/layers/layer query param, falls back to last path segment or hostname).
- getEndpointSnapshot(endpointKey): Return descriptive stats for a single endpoint (counts, rates, percentiles, mean, samples).
- getAllEndpointSnapshots(): Return an array of { endpoint, stats } for all tracked endpoints.
- getEndpointHistogram(endpointKey, binSize = 25, maxMs = null): Build histogram data (binEdges, counts, bins).
- plotEndpointHistogram(endpointKey, binSize = 25): Render and download a JPEG histogram with annotation text (uses Plotly). Returns { ok, filename, hist, stats }.
- plotHistogramAllEndpoints(opts = {}): Sequentially generate/download histograms for all known endpoints.



## Examples

Record a request and inspect stats:
```javascript
metrics.loadMetrics()
metrics.recordEndpointEvent('/api/tiles?LAYERS=roads', 95, 'success')
metrics.recordEndpointEvent('/api/tiles?LAYERS=roads', null, 'timeout')

const snap = metrics.getEndpointSnapshot('roads')

/*
snap example:
{
  totalCalls: 2,
  successfulCalls: 1,
  failedCalls: 0,
  timedOutCalls: 1,
  successRate: 0.5,
  failureRate: 0,
  timeoutRate: 0.5,
  samples: 1,
  mean: 95,
  p5: 95,
  p95: 95,
  lastUpdated: 1620000000000
}
*/
```

## License
MIT — 

## Contact
Create Issues, PR's or push directly to main. It is mainly a utility script, but feel free to contact  @AAFredsted in case of questions.