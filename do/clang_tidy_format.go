package do

import (
	"os/exec"
)

var clangPathCached string

func detectClangFormat() string {
	if clangPathCached != "" {
		return clangPathCached
	}
	path := detectPathMust(vsBasePaths, `VC\Tools\Llvm\bin\clang-format.exe`)
	panicIf(!fileExists(path), "didn't find clang-format.exe")
	logf("clang-format: %s\n", path)
	clangPathCached = path
	return clangPathCached
}

func clangFormatFile(path string) {
	clangFormatPath := detectClangFormat()
	cmd := exec.Command(clangFormatPath, "-i", "-style=file", path)
	runCmdLoggedMust(cmd)
}
