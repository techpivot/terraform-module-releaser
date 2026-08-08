import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * Guards the Node.js version alignment contract described in docs/node.md.
 *
 * Two worlds must stay coherent:
 * - Runtime world: action.yml `runs.using` defines the production runtime. `engines.node` and `@types/node` must
 *   anchor to that major so the compiler rejects APIs the GitHub Actions runner doesn't have.
 * - Dev world: `.node-version` and the devcontainer image pin the same major as the production runtime (parity
 *   policy), so local tests and CI execute on the line consumers run.
 *
 * It also guards a silent failure mode: the devcontainer image ships Node via nvm with
 * /usr/local/share/nvm/current/bin first on PATH. Re-adding the devcontainers `node` feature installs a second Node
 * that shadows the image's — matching neither the image tag nor .node-version, with no error anywhere.
 */

const readRepoFile = (relativePath: string): string => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

interface ActionYmlRuns {
  runs: { using: string };
}

interface DevcontainerJson {
  name?: string;
  image?: string;
  features?: Record<string, unknown>;
}

interface PackageJson {
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
}

const actionYml = yaml.load(readRepoFile('action.yml')) as ActionYmlRuns;
const devcontainer = JSON.parse(readRepoFile('.devcontainer/devcontainer.json')) as DevcontainerJson;
const packageJson = JSON.parse(readRepoFile('package.json')) as PackageJson;
const nodeVersionFile = readRepoFile('.node-version').trim();

const runtimeMajor = Number(/^node(\d+)$/.exec(actionYml.runs.using)?.[1]);
const devMajor = Number(/^(\d+)/.exec(nodeVersionFile)?.[1]);

describe('node version alignment', () => {
  it('should declare a nodeXX production runtime in action.yml', () => {
    expect(actionYml.runs.using).toMatch(/^node\d+$/);
    expect(Number.isNaN(runtimeMajor)).toBe(false);
  });

  it('should pin the engines.node floor to the production runtime major', () => {
    const floorMajor = Number(/^>=\s*(\d+)/.exec(packageJson.engines?.node ?? '')?.[1]);
    expect(floorMajor).toBe(runtimeMajor);
  });

  it('should pin @types/node to the production runtime major so post-runtime APIs fail typecheck', () => {
    const typesSpec = packageJson.devDependencies?.['@types/node'] ?? '';
    const typesMajor = Number(/^[\^~]?(\d+)/.exec(typesSpec)?.[1]);
    expect(typesMajor).toBe(runtimeMajor);
  });

  it('should pin .node-version to the production runtime major as a bare major (parity policy)', () => {
    expect(nodeVersionFile).toMatch(/^\d+$/);
    expect(devMajor).toBe(runtimeMajor);
  });
});

describe('devcontainer alignment', () => {
  it('should use a javascript-node image whose tag matches .node-version', () => {
    const image = devcontainer.image ?? '';
    expect(image).toMatch(/^mcr\.microsoft\.com\/devcontainers\/javascript-node:/);

    const imageMajor = Number(/:(\d+)/.exec(image)?.[1]);
    expect(imageMajor).toBe(devMajor);
  });

  it('should not re-add the devcontainers node feature, which silently shadows the image Node via nvm PATH order', () => {
    const featureIds = Object.keys(devcontainer.features ?? {});
    const nodeFeatures = featureIds.filter((id) => /\/features\/node(?::|@|$)/.test(id));
    expect(nodeFeatures).toEqual([]);
  });
});
