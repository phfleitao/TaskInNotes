import { isMap, isScalar, parseDocument, type Pair } from 'yaml';
import { configurationError, type BlockConfig } from './model';

export interface ParsedBlock { config: BlockConfig; snapshotRange?: [number, number]; idRange?: [number, number]; indent: string }
export function parseBlock(source: string): ParsedBlock {
  const doc = parseDocument(source, { uniqueKeys: true, keepSourceTokens: true, schema: 'core' });
  if (doc.errors.length || doc.warnings.length || !isMap(doc.contents) || doc.contents.flow) {
    if (isMap(doc.contents) && !doc.contents.flow) {
      const items = doc.contents.items;
      const generated = items.filter(pair => isScalar(pair.key) && pair.key.value === 'taskSnapshot');
      const key = generated[0]?.key;
      const start = isScalar(key) ? key.range?.[0] : undefined;
      if (generated.length === 1 && generated[0] === items.at(-1) && start !== undefined &&
        (start === 0 || source[start - 1] === '\n') && doc.errors.every(error => error.pos[0] >= start)) {
        const [declaration, ...lines] = source.slice(start).split(/\r?\n/);
        // Recover only the final, indented generated subtree. A dedented key or
        // inline broken scalar could change the configuration boundary: preserve it.
        if (/^taskSnapshot:[ \t]*(?:#.*)?$/.test(declaration!) && lines.every(line => !line.trim() || /^ {2,}/.test(line) || /^#/.test(line))) {
          const prefix = parseBlock(source.slice(0, start));
          return { ...prefix, snapshotRange: [start, source.length] };
        }
      }
    }
    return configurationError('Invalid or ambiguous YAML. Check the configuration and snapshot in the block source.');
  }
  const values: Record<string, unknown> = Object.create(null);
  let snapshotRange: [number, number] | undefined;
  let idRange: [number, number] | undefined;
  for (let i = 0; i < doc.contents.items.length; i++) {
    const pair: Pair = doc.contents.items[i]!;
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') return configurationError('Configuration keys must be plain strings.');
    const key = pair.key.value;
    if (!['schemaVersion', 'id', 'filter', 'title', 'taskSnapshot'].includes(key)) return configurationError('Unknown configuration key. Use schemaVersion, id, filter, title and taskSnapshot only.');
    const start = pair.key.range?.[0];
    if (key === 'taskSnapshot') {
      if (start === undefined) return configurationError('The snapshot cannot be located safely.');
      const next = doc.contents.items[i + 1]?.key;
      const end = isScalar(next) ? next.range?.[0] : undefined;
      snapshotRange = [start, end ?? source.length];
      continue;
    }
    if (!isScalar(pair.value)) return configurationError('Configuration values must be scalar values.');
    values[key] = pair.value.value;
    if (key === 'id' && start !== undefined) {
      // Change only the value, keeping comments and the surrounding document intact.
      const range = pair.value.range;
      if (range) idRange = [range[0], range[1]];
    }
  }
  if (values.schemaVersion !== undefined && values.schemaVersion !== 1) return configurationError('Unsupported schemaVersion. Use version 1.');
  if (typeof values.filter !== 'string' || !values.filter.trim()) return configurationError('A non-empty string filter is required.');
  if (values.id !== undefined && (typeof values.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(values.id))) {
    return configurationError('The block ID must be a non-empty identifier (letters, numbers, dots, underscores or dashes).');
  }
  if (values.title !== undefined && typeof values.title !== 'string') return configurationError('The title must be a string.');
  const config: BlockConfig = { ...(typeof values.title === 'string' && values.title.trim() ? { title: values.title.trim() } : {}), schemaVersion: 1, ...(values.id === undefined ? {} : { id: values.id as string }), filter: values.filter };
  const firstKey = doc.contents.items[0]?.key;
  const firstOffset = isScalar(firstKey) ? firstKey.range?.[0] ?? 0 : 0;
  const indent = source.slice(source.lastIndexOf('\n', firstOffset - 1) + 1, firstOffset);
  if (!/^ *$/.test(indent)) return configurationError('Use ordinary YAML configuration keys without explicit key syntax.');
  return { config, snapshotRange, idRange, indent };
}

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveFilter(template: string, title: string, properties: Readonly<Record<string, unknown>>): string {
  const result = template.replace(/\{\{([^{}]+)\}\}/g, (match: string, name: string, offset: number) => {
    let value: unknown;
    if (name === 'title' || name === 'noteDate') value = title;
    else if (name.startsWith('property:') && name.length > 9) {
      const key = name.slice(9);
      value = Object.hasOwn(properties, key) ? properties[key] : undefined;
    } else return configurationError('Unknown filter placeholder.');
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) return configurationError('A filter placeholder is missing or is not a single-line string.');
    const before = template.slice(0, offset);
    const dateOperand = /\b(?:date|due|deadline)(?:\s+(?:before|after))?:\s*$/i.test(before);
    if ((name === 'noteDate' || dateOperand) && !validDate(value)) return configurationError('Date placeholders require a valid YYYY-MM-DD date.');
    return value;
  }).trim();
  if (!result || result.length > 1024) return configurationError('The resolved filter must contain 1–1024 characters.');
  return result;
}
