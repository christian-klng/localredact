// Entry point of the bundled server inside the desktop app. It installs the
// network guard before a single line of the server runs. (Passing the guard to
// the process as a --require flag does not work: Electron's utility process
// does not honour it.)
require('./network-guard')
require('./server')
