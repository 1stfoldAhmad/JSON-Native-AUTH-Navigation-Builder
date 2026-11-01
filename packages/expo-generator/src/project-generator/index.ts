import { generateAuthFiles } from '@expo-foundation/auth';
import {
  defaultFoundationCompiler,
  type CompilerInput,
  type Diagnostic,
  type FoundationIR,
} from '@expo-foundation/core';
import { generateIntegrationFiles } from '@expo-foundation/integration';
import { generateNavigationFiles } from '@expo-foundation/navigation';
import { generateProjectConfigFiles } from '../config-generator/index.js';

export interface GeneratedProjectFile {
  path: string;
  content: string;
  ownership: 'generated' | 'user-protected';
  checksum: string;
}

export interface GenerationManifest {
  manifestVersion: '1.0.0';
  projectId: string;
  compilerVersion: string;
  sdkVersion: number;
  mode: 'auth-only' | 'navigation-only' | 'complete';
  files: Record<
    string,
    {
      ownership: 'generated' | 'user-protected';
      checksum: string;
    }
  >;
}

export interface GeneratedProjectBundle {
  ir: FoundationIR;
  files: Record<string, GeneratedProjectFile>;
  manifest: GenerationManifest;
  diagnostics: Diagnostic[];
  preservedUserFiles: string[];
  modifiedGeneratedFiles: string[];
}

/**
 * Computes a deterministic FNV-1a 64-bit hex checksum suitable for both Node and browser runtimes.
 */
export function computeDeterministicChecksum(content: string): string {
  let h1 = 0xdeadbeef ^ content.length;
  let h2 = 0x41c6ce57 ^ content.length;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h1 >>> 0).toString(16).padStart(8, '0')
  );
}

export interface GenerateProjectOptions {
  existingFiles?: Record<string, string>;
  previousManifest?: GenerationManifest;
  allowOverwriteModifiedGenerated?: boolean;
}

export class ExpoProjectGenerator {
  generateFromIR(
    ir: FoundationIR,
    options?: GenerateProjectOptions,
    priorDiagnostics: Diagnostic[] = []
  ): GeneratedProjectBundle {
    const rawFiles: Array<{
      path: string;
      content: string;
      ownership: 'generated' | 'user-protected';
    }> = [];

    rawFiles.push(...generateProjectConfigFiles(ir));

    if (ir.auth && ir.auth.enabled) {
      rawFiles.push(...generateAuthFiles(ir.auth));
    }

    if (ir.navigation) {
      rawFiles.push(...generateNavigationFiles(ir.navigation));
    }

    if (ir.integration && ir.integration.enabled) {
      rawFiles.push(...generateIntegrationFiles(ir.integration));
    }

    const filesMap: Record<string, GeneratedProjectFile> = {};
    const manifestEntries: GenerationManifest['files'] = {};
    const preservedUserFiles: string[] = [];
    const modifiedGeneratedFiles: string[] = [];
    const diagnostics: Diagnostic[] = [...priorDiagnostics];

    const existing = options?.existingFiles ?? {};
    const prevManifest = options?.previousManifest;

    // Sort paths deterministically
    rawFiles.sort((a, b) => a.path.localeCompare(b.path));

    for (const item of rawFiles) {
      const existingContent = existing[item.path];

      // Rule 2: User-written files must not be overwritten
      if (item.ownership === 'user-protected' && existingContent !== undefined) {
        const checksum = computeDeterministicChecksum(existingContent);
        filesMap[item.path] = {
          path: item.path,
          content: existingContent,
          ownership: 'user-protected',
          checksum,
        };
        manifestEntries[item.path] = {
          ownership: 'user-protected',
          checksum,
        };
        preservedUserFiles.push(item.path);
        continue;
      }

      // Rule 6: Detect manual modifications to previously generated files
      if (
        item.ownership === 'generated' &&
        existingContent !== undefined &&
        prevManifest?.files[item.path]
      ) {
        const actualExistingChecksum = computeDeterministicChecksum(existingContent);
        const expectedPreviousChecksum = prevManifest.files[item.path].checksum;
        if (actualExistingChecksum !== expectedPreviousChecksum) {
          modifiedGeneratedFiles.push(item.path);
          diagnostics.push({
            code: 'GEN_MANUAL_MODIFICATION_DETECTED',
            severity: 'warning',
            document: 'system',
            jsonPath: item.path,
            message: `WARNING: Manual modification detected in builder-generated file "${item.path}".`,
            suggestion:
              'Move custom logic to src/screens/registry.ts or external modules so regeneration remains deterministic.',
            canGenerate: true,
          });
          if (options?.allowOverwriteModifiedGenerated === false) {
            filesMap[item.path] = {
              path: item.path,
              content: existingContent,
              ownership: 'generated',
              checksum: actualExistingChecksum,
            };
            manifestEntries[item.path] = {
              ownership: 'generated',
              checksum: actualExistingChecksum,
            };
            continue;
          }
        }
      }

      const checksum = computeDeterministicChecksum(item.content);
      filesMap[item.path] = {
        path: item.path,
        content: item.content,
        ownership: item.ownership,
        checksum,
      };
      manifestEntries[item.path] = {
        ownership: item.ownership,
        checksum,
      };
    }

    // Also preserve any extra user files in existingFiles that are not part of the generator
    for (const [existingPath, existingContent] of Object.entries(existing)) {
      if (!filesMap[existingPath] && existingPath !== '.foundation-manifest.json') {
        const checksum = computeDeterministicChecksum(existingContent);
        filesMap[existingPath] = {
          path: existingPath,
          content: existingContent,
          ownership: 'user-protected',
          checksum,
        };
        preservedUserFiles.push(existingPath);
      }
    }

    const manifest: GenerationManifest = {
      manifestVersion: '1.0.0',
      projectId: ir.projectMetadata.projectId,
      compilerVersion: ir.projectMetadata.builderVersion,
      sdkVersion: ir.projectMetadata.sdkVersion,
      mode: ir.projectMetadata.mode,
      files: manifestEntries,
    };

    const manifestContent = `${JSON.stringify(manifest, null, 2)}\n`;
    filesMap['.foundation-manifest.json'] = {
      path: '.foundation-manifest.json',
      content: manifestContent,
      ownership: 'generated',
      checksum: computeDeterministicChecksum(manifestContent),
    };

    return {
      ir,
      files: filesMap,
      manifest,
      diagnostics,
      preservedUserFiles,
      modifiedGeneratedFiles,
    };
  }

  compileAndGenerate(
    input: CompilerInput,
    options?: GenerateProjectOptions
  ): GeneratedProjectBundle {
    const compilation = defaultFoundationCompiler.compile(input);
    if (!compilation.ir || !compilation.canGenerate) {
      const errorMessages = compilation.diagnostics
        .filter((d) => !d.canGenerate)
        .map((d) => `[${d.code}] ${d.message}`)
        .join('; ');
      throw new Error(
        `Cannot generate Expo project due to blocking compilation errors: ${errorMessages}`
      );
    }
    return this.generateFromIR(compilation.ir, options, compilation.diagnostics);
  }
}

export const defaultExpoProjectGenerator = new ExpoProjectGenerator();
