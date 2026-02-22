function restoreCursor() {
  process.stdout.write('\x1B[?25h')
}

process.on('SIGINT', () => {
  restoreCursor()
  process.exit(130)
})
process.on('SIGTERM', () => {
  restoreCursor()
  process.exit(143)
})
process.on('exit', restoreCursor)
