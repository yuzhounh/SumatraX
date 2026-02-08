package do

import (
	"archive/zip"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

var (
	preReleaseVerCached string
	gitSha1Cached       string
	sumatraVersion      string
)

func getGitSha1() string {
	panicIf(gitSha1Cached == "", "must call detectVersions() first")
	return gitSha1Cached
}

func getPreReleaseVer() string {
	panicIf(preReleaseVerCached == "", "must call detectVersions() first")
	return preReleaseVerCached
}

func isNum(s string) bool {
	_, err := strconv.Atoi(s)
	return err == nil
}

// Version must be in format x.y.z
func verifyCorrectVersionMust(ver string) {
	parts := strings.Split(ver, ".")
	panicIf(len(parts) == 0 || len(parts) > 3, "%s is not a valid version number", ver)
	for _, part := range parts {
		panicIf(!isNum(part), "%s is not a valid version number", ver)
	}
}

const (
	// kVSPlatform32    = "Win32"
	// kVSPlatform64    = "x64"
	kVSPlatformArm64 = "ARM64"
)

type Platform struct {
	vsplatform string // ARM64, Win32, x64 - as in Visual Studio platform
	suffix     string // e.g. 32, 64, arm64
	outDir     string // e.g. out/rel32, out/rel64, out/arm64
}

var platformArm64 = &Platform{kVSPlatformArm64, "arm64", filepath.Join("out", "arm64")}
var platform32 = &Platform{"Win32", "32", filepath.Join("out", "rel32")}
var platform64 = &Platform{"x64", "64", filepath.Join("out", "rel64")}

var platforms = []*Platform{
	platformArm64,
	platform32,
	platform64,
}

func getFileNamesWithPrefix(prefix string) [][]string {
	files := [][]string{
		{"SumatraPDF.exe", fmt.Sprintf("%s.exe", prefix)},
		{"SumatraPDF-dll.exe", fmt.Sprintf("%s-install.exe", prefix)},
		{"SumatraPDF.pdb.zip", fmt.Sprintf("%s.pdb.zip", prefix)},
		{"SumatraPDF.pdb.lzsa", fmt.Sprintf("%s.pdb.lzsa", prefix)},
	}
	return files
}

func extractSumatraVersionMust() string {
	path := filepath.Join("src", "Version.h")
	lines, err := readLinesFromFile(path)
	must(err)
	s := "#define CURR_VERSION "
	for _, l := range lines {
		if strings.HasPrefix(l, s) {
			ver := l[len(s):]
			verifyCorrectVersionMust(ver)
			return ver
		}
	}
	panic(fmt.Sprintf("couldn't extract CURR_VERSION from %s\n", path))
}

func detectVersions() {
	ver := getGitLinearVersionMust()
	preReleaseVerCached = strconv.Itoa(ver)
	gitSha1Cached = getGitSha1Must()
	sumatraVersion = extractSumatraVersionMust()
	logf("preReleaseVer: '%s'\n", preReleaseVerCached)
	logf("gitSha1: '%s'\n", gitSha1Cached)
	logf("sumatraVersion: '%s'\n", sumatraVersion)
}

var (
	nSkipped      = 0
	nDirsDeleted  = 0
	nFilesDeleted = 0
)

func clearDirPreserveSettings(path string) {
	entries2, err := os.ReadDir(path)
	if errors.Is(err, fs.ErrNotExist) {
		return
	}
	must(err)
	for _, e2 := range entries2 {
		name := e2.Name()
		path2 := filepath.Join(path, name)
		// delete everything except those files
		excluded := (name == "sumatrapdfcache") || (name == "SumatraPDF-settings.txt") || strings.Contains(name, "asan")
		if excluded {
			nSkipped++
			continue
		}
		if e2.IsDir() {
			os.RemoveAll(path2)
			nDirsDeleted++
		} else {
			os.Remove(path2)
			nFilesDeleted++
		}
	}
}

// remove all files and directories under out/ except settings files
func cleanPreserveSettings() {
	entries, err := os.ReadDir("out")
	if err != nil {
		// assuming 'out' doesn't exist, which is fine
		return
	}
	nSkipped = 0
	nDirsDeleted = 0
	nFilesDeleted = 0
	for _, e := range entries {
		path := filepath.Join("out", e.Name())
		if !e.IsDir() {
			os.Remove(path)
			continue
		}
		clearDirPreserveSettings(path)
	}
	logf("clean: skipped %d files, deleted %d dirs and %d files\n", nSkipped, nDirsDeleted, nFilesDeleted)
}

func cleanReleaseBuilds() {
	for _, plat := range platforms {
		clearDirPreserveSettings(plat.outDir)
	}
}

func buildLzsa() {
	// early exit if missing
	detectSigntoolPathMust()

	defer makePrintDuration("buildLzsa")()
	cleanPreserveSettings()

	msbuildPath := detectMsbuildPathMust()
	runExeLoggedMust(msbuildPath, `vs2022\MakeLZSA.sln`, `/t:MakeLZSA:Rebuild`, `/p:Configuration=Release;Platform=Win32`, `/m`)

	dir := filepath.Join("out", "rel32")
	files := []string{"MakeLZSA.exe"}
	signFiles(dir, files)
	logf("built and signed '%s'\n", filepath.Join(dir, files[0]))
}

func buildConfigPath() string {
	return filepath.Join("src", "utils", "BuildConfig.h")
}

func getBuildConfigCommon() string {
	sha1 := getGitSha1()
	s := fmt.Sprintf("#define GIT_COMMIT_ID %s\n", sha1)
	todayDate := time.Now().Format("2006-01-02")
	s += fmt.Sprintf("#define BUILT_ON %s\n", todayDate)
	return s
}

func setBuildConfigRelease() {
	s := getBuildConfigCommon()
	err := os.WriteFile(buildConfigPath(), []byte(s), 0644)
	must(err)
}

func revertBuildConfig() {
	runExeMust("git", "checkout", buildConfigPath())
}

func addZipDataStore(w *zip.Writer, data []byte, nameInZip string) error {
	fih := &zip.FileHeader{
		Name:   nameInZip,
		Method: zip.Store,
	}
	fw, err := w.CreateHeader(fih)
	if err != nil {
		return err
	}
	_, err = fw.Write(data)
	return err
}

// manifest is build for pre-release builds and contains information about file sizes
func createManifestMust(manifestPath string) {
	var lines []string
	files := []string{
		"SumatraPDF.exe",
		"SumatraPDF-dll.exe",
		"libmupdf.dll",
		"PdfFilter.dll",
		"PdfPreview.dll",
		"SumatraPDF.pdb.zip",
		"SumatraPDF.pdb.lzsa",
	}
	for _, plat := range platforms {
		dir := plat.outDir
		// 32bit / arm64 are only in daily build
		if !pathExists(dir) {
			continue
		}
		for _, file := range files {
			path := filepath.Join(dir, file)
			size := fileSizeMust(path)
			line := fmt.Sprintf("%s: %d", path, size)
			lines = append(lines, line)
		}
	}
	panicIf(len(lines) == 0, "didn't find any dirs for the manifest")

	s := strings.Join(lines, "\n")
	writeFileCreateDirMust(manifestPath, []byte(s))
}

func detectVersionsCodeQL() {
	//ver := getGitLinearVersionMust()
	ver := 16648 // we don't have git history in codeql checkout
	preReleaseVerCached = strconv.Itoa(ver)
	gitSha1Cached = getGitSha1Must()
	sumatraVersion = extractSumatraVersionMust()
	logf("preReleaseVer: '%s'\n", preReleaseVerCached)
	logf("gitSha1: '%s'\n", gitSha1Cached)
	logf("sumatraVersion: '%s'\n", sumatraVersion)
}

// build for codeql: just static 64-bit release build
func buildCodeQL() {
	detectVersionsCodeQL()
	//cleanPreserveSettings()
	msbuildPath := detectMsbuildPathMust()
	runExeLoggedMust(msbuildPath, `vs2022\SumatraPDF.sln`, `/t:SumatraPDF:Rebuild`, `/p:Configuration=Release;Platform=x64`, `/m`)
	revertBuildConfig()
}

func waitForEnter(s string) {
	// wait for keyboard press
	if s == "" {
		s = "\nPress Enter to continue\n"
	}
	logf(s)
	fmt.Scanln()
}
