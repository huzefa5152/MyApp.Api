/*
 * Resolve the app's extensionless relative imports ("./templateEngine") when
 * running its modules under plain Node. Vite adds the extension at build time;
 * Node's ESM resolver does not, so the pagination harness registers this hook
 * to load myapp-frontend/src/utils/* unmodified rather than duplicating them.
 */
import path from "path";

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".") && !path.extname(specifier)) {
      return next(specifier + ".js", context);
    }
    throw err;
  }
}
