import { loadConfig } from '../cr/config.js';

async function main() {
  try {
    const cfg = await loadConfig();
    if (cfg === null) {
      console.log('.noldor/config.json absent (OK — interactive mode only)');
      process.exit(0);
    }
    console.log('.noldor/config.json valid');
    console.log(JSON.stringify(cfg, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('.noldor/config.json INVALID:');
    console.error((err as Error).message);
    process.exit(1);
  }
}

main();
