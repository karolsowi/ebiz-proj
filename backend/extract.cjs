const fs = require('fs');

function extractMetrics(file) {
  if (!fs.existsSync(file)) {
    console.log(`File ${file} does not exist.`);
    return;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('--- ' + file + ' ---');
  console.log('Winner:', data.winner);
  
  if (data.results) {
    for (const [strategy, result] of Object.entries(data.results)) {
      const p = result.performance;
      const t = result.trades || [];
      const e = result.equityCurve || [];
      
      console.log(`Strategy: ${strategy}`);
      console.log(`  Total Return: ${p.totalReturnPct.toFixed(2)}%`);
      console.log(`  Sharpe: ${p.sharpeRatio.toFixed(2)}`);
      console.log(`  Sortino: ${p.sortinoRatio.toFixed(2)}`);
      console.log(`  Max Drawdown: ${p.maxDrawdownPct.toFixed(2)}%`);
      console.log(`  Win Rate: ${p.winRatePct.toFixed(2)}%`);
      
      console.log(`  Trades: ${p.winningTrades}W / ${p.losingTrades}L / ${p.totalTrades}T`);
      if (e.length > 0) {
        console.log(`  Equity Start: ${e[0].equity}, End: ${e[e.length-1].equity.toFixed(2)}`);
      }
    }
  } else {
    console.log('No results found in', file);
  }
}

extractMetrics('results_2026_Q1.json');
extractMetrics('results_2025_Dec.json');
