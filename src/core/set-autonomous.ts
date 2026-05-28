import { setAutonomous } from './session.js';

try {
  setAutonomous(process.cwd());
  process.stdout.write('session.autonomous = true\n');
} catch (err) {
  process.stderr.write(`${(err as Error).message}\n`);
  process.exit(1);
}
