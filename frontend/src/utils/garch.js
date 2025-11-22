// JS implementation of the GARCH(1,1) simulation described.
// Returns array of simulations: [ [r0...rT], [ ... ] , ... ]
export function simulateGarch({ omega = 1e-6, alpha = 0.05, beta = 0.9, mu = 0.001, sim_horizon = 50, simulations = 3, seed = 42 }) {
  // simple seeded RNG (Park-Miller-ish)
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;

  let sigma2 = new Array(simulations).fill(omega / (1 - alpha - beta));
  const simPaths = Array.from({ length: simulations }, () => new Array(sim_horizon).fill(0));

  for (let t = 0; t < sim_horizon; t++) {
    const z = Array.from({ length: simulations }, () => (rand() - 0.5) * 2); // approx standard
    for (let i = 0; i < simulations; i++) {
      const eps = Math.sqrt(Math.max(0, sigma2[i])) * z[i];
      const r = mu + eps;
      simPaths[i][t] = r;
      sigma2[i] = omega + alpha * eps * eps + beta * sigma2[i];
    }
  }

  // convert raw returns to cumulative price paths starting at 100
  const simPrices = simPaths.map((path) => {
    const out = [];
    let sPrice = 100;
    for (const r of path) {
      sPrice = sPrice * Math.exp(r);
      out.push(sPrice);
    }
    return out;
  });

  return simPrices;
}
