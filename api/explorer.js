const BASE = 'https://explorer.beldex.io/api';

async function grab(path) {
  const r = await fetch(`${BASE}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function formatBytes(bytes) {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' TB';
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return bytes + ' B';
}

function formatKB(bytes) {
  return Math.round(bytes / 1000) + 'kB';
}

export default async function handler(req, res) {
  // CORS — only allow Chrome extensions
  const origin = req.headers.origin || '';
  if (origin.startsWith('chrome-extension://')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Headers', 'x-api-key');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // API key check
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.BDX_API_KEY) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  try {
    const [netInfo, emission, stats, mnStats] = await Promise.all([
      grab('networkinfo'),
      grab('emission'),
      grab('get_stats'),
      grab('master_node_stats'),
    ]);

    // Validate API responses
    const ni = netInfo?.data;
    const em = emission?.data;
    const st = stats?.data;
    const mn = mnStats?.data;

    if (!ni || !em || !st || !mn) {
      return res.status(502).json({ ok: false, error: 'Upstream data unavailable' });
    }

    // Atomic units → BDX (1 BDX = 1e9 atomic)
    const circulatingSupply = em.circulating_supply / 1e9;
    const burnedBDX = em.burn / 1e9;
    const lastReward = (st.last_reward / 1e9).toFixed(2);

    // Fee estimation from block size
    const baseFeeOutput = (0.026).toFixed(4);
    const flashFeeOutput = (0.052).toFixed(4);

    const data = {
      blockHeight: ni.height,
      hardFork: 'v' + ni.current_hf_version,
      txPoolCount: ni.tx_pool_size,
      blockSizeSoft: formatKB(ni.block_size_median),
      blockSizeHard: formatKB(ni.block_size_limit),
      blockchainSize: formatBytes(ni.database_size),
      totalBNS: ni.bns_counts,
      circulatingSupply,
      burnedBDX,
      lastReward,
      activeNodes: mn.active,
      decomNodes: mn.decommissioned,
      awaitingNodes: mn.awaiting_contribution,
      baseFeeOutput,
      flashFeeOutput,
      fetchedAt: Date.now(),
    };

    res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error('[explorer] Error:', e.message);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
}
