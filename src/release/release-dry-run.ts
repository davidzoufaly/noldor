import { loadConsumerConfig } from '../core/consumer-config.js';
import { generateFdChangelogs } from './release-fd-changelog.js';

const previousTag = process.env.PREV_TAG;
const newVersion = process.env.NEW_VERSION;
const date = process.env.DATE;
if (!previousTag || !newVersion || !date) {
  console.error('PREV_TAG, NEW_VERSION, DATE env vars required.');
  process.exitCode = 1;
} else {
  const { repoUrl } = loadConsumerConfig();
  const map = await generateFdChangelogs({
    featuresDir: 'docs/features',
    previousTag,
    newVersion,
    date,
    repoUrl,
  });
  console.log('changelog slugs:', [...map.keys()]);
}
