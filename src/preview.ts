/** Save a real model response for Harness's built-in HTML document preview. */
import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-fs';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-sandbox-policy';

/**
 * Write the supplied HTML through the session's filesystem and return its absolute path.
 * Missing optional host capabilities leave the fenced HTML response usable; filesystem errors
 * propagate to the caller, including sandbox denials and concurrent file changes.
 * @param ctx Plugin context with optional agent-registry access.
 * @param options Original conversation request identifying the session and latest human input.
 * @param html HTML returned by the local model for this request.
 * @param signal Combined request cancellation, plugin shutdown and generation deadline.
 * @returns The saved document's absolute path, or undefined without a preview-capable session.
 */
export async function createPreview(
  ctx: Context,
  options: GenerateOptions,
  html: string,
  signal: AbortSignal | undefined = options.signal,
): Promise<string | undefined> {
  if (options.sessionId === undefined) return undefined;
  const agent = ctx.get('agents')?.get(options.sessionId);
  if (agent === undefined) return undefined;
  const fs = agent.ctx.get('fs');
  if (fs === undefined) return undefined;
  const cwd = agent.ctx.get('workingDirectory')?.get(agent.session) ?? agent.session.header.cwd;
  if (cwd === undefined) return undefined;

  signal?.throwIfAborted();
  const target = await fs.resolve(`pelican-${randomUUID()}.html`, { cwd, signal });
  const policy = agent.ctx.get('sandboxPolicy')?.resolve({ session: agent.session });
  await fs.writeText(target, html, { kind: 'createIfAbsent' }, signal, policy);
  return fs.processPath(target);
}
