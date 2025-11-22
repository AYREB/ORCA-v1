// Simulate geometric brownian motion paths
export function simulateMC(S0 = 100, mu = 0.05, sigma = 0.2, steps = 252, sims = 10) {
  const dt = 1 / steps;
  const paths = [];

  for (let i = 0; i < sims; i++) {
    let s = S0;
    const arr = [];
    for (let t = 0; t < steps; t++) {
      // Box-Muller for standard normal
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      s = s * Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * z);
      arr.push(s);
    }
    paths.push(arr);
  }

  return paths;
}
