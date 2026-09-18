import { Box, Button, Stack } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { renderToStaticMarkup } from 'react-dom/server'

const download = (text: string, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const markdown = (text: string) => <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{text}</ReactMarkdown>
export default function MarkdownMessage({ text, exportable = false }: { text: string; exportable?: boolean }) {
  return <Box sx={{ overflowWrap: 'anywhere', whiteSpace: 'normal', lineHeight: 1.6,
    '& > :first-of-type': { mt: 0 }, '& p:last-child': { mb: 0 }, '& h1': { fontSize: 21 }, '& h2': { fontSize: 18 }, '& h3': { fontSize: 16 },
    '& table': { display: 'block', overflowX: 'auto', borderCollapse: 'collapse', maxWidth: '100%' },
    '& th, & td': { border: '1px solid', borderColor: 'divider', p: .75, textAlign: 'left' },
    '& pre': { overflowX: 'auto', bgcolor: 'rgba(0,0,0,.2)', p: 1, borderRadius: 1 }, '& a': { color: 'primary.light' }, '& code': { fontSize: '.9em' },
  }}>
    {markdown(text)}
    {exportable && <Stack direction="row" spacing={1} mt={1}>
      <Button size="small" onClick={() => download(text, 'buckle-report.md', 'text/markdown;charset=utf-8')}>MD</Button>
      <Button size="small" onClick={() => download('<!doctype html><html><head><meta charset="utf-8"><title>Buckle report</title><style>body{max-width:1100px;margin:40px auto;padding:20px;font:16px/1.6 system-ui}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:8px}pre{overflow:auto;background:#eee;padding:16px}</style></head><body>' + renderToStaticMarkup(markdown(text)) + '</body></html>', 'buckle-report.html', 'text/html;charset=utf-8')}>HTML</Button>
    </Stack>}
  </Box>
}
