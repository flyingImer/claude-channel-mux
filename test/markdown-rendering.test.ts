import { test, expect } from 'bun:test'
import { autoFenceAsciiArt, renderForSlack, renderForTelegram, splitForLimit } from '../adapters/markdown.ts'

test('Slack renderer preserves markdown styling and link forwarding', () => {
  const rendered = renderForSlack('**bold** [OpenAI](https://openai.com)')
  expect(rendered).toContain('*bold*')
  expect(rendered).toContain('<https://openai.com|OpenAI>')
})

test('Telegram renderer emits MarkdownV2-compatible forwarded styling', () => {
  const rendered = renderForTelegram('**bold** [OpenAI](https://openai.com)')
  expect(rendered).toContain('*bold*')
  expect(rendered).toContain('[OpenAI](https://openai.com)')
})

test('Slack and Telegram renderers convert GFM tables into aligned code blocks', () => {
  const table = '| Name | Value |\n|---|---|\n| alpha | 1 |\n| beta | 22 |'
  const slack = renderForSlack(table)
  const telegram = renderForTelegram(table)
  for (const rendered of [slack, telegram]) {
    expect(rendered).toContain('```')
    expect(rendered).toContain('| Name  | Value |')
    expect(rendered).toContain('| beta  | 22    |')
  }
})


test('Pipe-delimited prose without a GFM separator is not table-fenced', () => {
  const text = '| not a table |\n| maybe prose |'
  expect(renderForSlack(text)).not.toContain('```')
  expect(renderForTelegram(text)).not.toContain('```')
})

test('Outer fenced markdown is unwrapped before platform rendering', () => {
  const markdown = '```markdown\n# Title\n\n- item\n```'
  expect(renderForSlack(markdown)).toContain('*Title*')
  expect(renderForTelegram(markdown)).toContain('*Title*')
  expect(renderForSlack(markdown)).not.toContain('```markdown')
})


test('Whole-message code fences remain code blocks unless explicitly markdown', () => {
  const code = '```ts\nconst x = 1\nconsole.log(x)\n```'
  expect(renderForSlack(code)).toContain('```')
  expect(renderForSlack(code)).toContain('const x = 1')
  expect(renderForTelegram(code)).toContain('```')
  expect(renderForTelegram(code)).toContain('const x = 1')
})

test('GFM tables inside existing fences are not double-wrapped', () => {
  const fencedTable = '```\n| A | B |\n|---|---|\n| 1 | 2 |\n```'
  for (const rendered of [renderForSlack(fencedTable), renderForTelegram(fencedTable)]) {
    expect((rendered.match(/^```/gm) ?? []).length).toBe(2)
    expect(rendered).toContain('|---|---|')
  }
})

test('ASCII art is auto-fenced without fencing normal prose', () => {
  const rendered = autoFenceAsciiArt('before\n┌──┐\n│hi│\n└──┘\nafter')
  expect(rendered).toContain('```\n┌──┐\n│hi│\n└──┘\n```')
  expect(autoFenceAsciiArt('just | prose | line')).toBe('just | prose | line')
})

test('autoFenceAsciiArt closes unterminated fences with the original marker', () => {
  expect(autoFenceAsciiArt('~~~python\nprint(1)')).toBe('~~~python\nprint(1)\n~~~')
  expect(autoFenceAsciiArt('````md\n# title')).toBe('````md\n# title\n````')
})

test('splitForLimit preserves code fence balance across chunks', () => {
  const chunks = splitForLimit('```\n' + 'x\n'.repeat(20) + '```', 30)
  expect(chunks.length).toBeGreaterThan(1)
  for (const chunk of chunks) {
    expect((chunk.match(/^```/gm) ?? []).length % 2).toBe(0)
  }
})

test('splitForLimit preserves tilde, indented, and longer code fences', () => {
  const cases = [
    { text: '~~~\n' + 'x\n'.repeat(20) + '~~~', marker: '~~~' },
    { text: '  ```\n' + 'x\n'.repeat(20) + '  ```', marker: '```' },
    { text: '````\n' + 'x\n'.repeat(20) + '````', marker: '````' },
  ]

  for (const { text, marker } of cases) {
    const chunks = splitForLimit(text, 30)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const fenceLines = chunk.split('\n').filter(line => line.trim().startsWith(marker))
      expect(fenceLines.length % 2).toBe(0)
    }
  }
})


test('splitForLimit preserves fence language when reopening chunks', () => {
  const chunks = splitForLimit('```ts\n' + 'const x = 1\n'.repeat(20) + '```', 80)
  expect(chunks.length).toBeGreaterThan(1)
  expect(chunks[1]).toStartWith('```ts\n')
})


test('Slack and Telegram adapters route send/edit through markdown renderers', () => {
  const slack = Bun.file('adapters/slack.ts').text()
  const telegram = Bun.file('adapters/telegram.ts').text()
  return Promise.all([slack, telegram]).then(([slackSource, telegramSource]) => {
    expect(slackSource).toContain("import { renderForSlack, splitForLimit } from './markdown.js'")
    expect(slackSource).toContain('const rendered = renderForSlack(text)')
    expect(slackSource).toContain('function slackMessageBlocks(rendered: string, inlineKeyboard: unknown): SlackBlock[]')
    expect(slackSource).toContain("text: { type: 'mrkdwn', text }")
    expect(telegramSource).toContain("import { renderForTelegram, splitForLimit } from './markdown.js'")
    expect(telegramSource).toContain('const rendered = renderForTelegram(text)')
    expect(telegramSource).toContain("parse_mode: 'MarkdownV2'")
  })
})
