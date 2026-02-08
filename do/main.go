package do

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/kjk/common/u"
)

var (
	r2Access          string
	r2Secret          string
	b2Access          string
	b2Secret          string
	transUploadSecret string
)

func loadSecrets() bool {
	var m map[string]string
	panicIf(!u.IsWinOrMac(), "secretsEnv is empty and running on linux")
	secretsSrcPath := filepath.Join("..", "secrets", "sumatrapdf.env")
	d, err := os.ReadFile(secretsSrcPath)
	if err != nil {
		logf("Failed to read secrets from %s, will try env variables\n", secretsSrcPath)
		return false
	}
	m = u.ParseEnvMust(d)

	getEnv := func(key string, val *string, minLen int) {
		v := strings.TrimSpace(m[key])
		if len(v) < minLen {
			logf("Missing %s, len: %d, wanted: %d\n", key, len(v), minLen)
			return
		}
		*val = v
		// logf("Got %s, '%s'\n", key, v)
		logf("Got %s\n", key)
	}
	getEnv("R2_ACCESS", &r2Access, 8)
	getEnv("R2_SECRET", &r2Secret, 8)
	getEnv("BB_ACCESS", &b2Access, 8)
	getEnv("BB_SECRET", &b2Secret, 8)
	getEnv("TRANS_UPLOAD_SECRET", &transUploadSecret, 4)
	return true
}

func ensureAllUploadCreds() {
	panicIf(r2Access == "", "Not uploading to s3 because R2_ACCESS env variable not set\n")
	panicIf(r2Secret == "", "Not uploading to s3 because R2_SECRET env variable not set\n")
	panicIf(b2Access == "", "Not uploading to backblaze because BB_ACCESS env variable not set\n")
	panicIf(b2Secret == "", "Not uploading to backblaze because BB_SECRET env variable not set\n")
}

func getSecrets() {
	if loadSecrets() {
		return
	}
	r2Access = os.Getenv("R2_ACCESS")
	r2Secret = os.Getenv("R2_SECRET")
	b2Access = os.Getenv("BB_ACCESS")
	b2Secret = os.Getenv("BB_SECRET")
	transUploadSecret = os.Getenv("TRANS_UPLOAD_SECRET")
}

type BuildOptions struct {
	upload                    bool
	verifyTranslationUpToDate bool
	doCleanCheck              bool
	releaseBuild              bool
}

func ensureBuildOptionsPreRequesites(opts *BuildOptions) {
	logf("upload: %v\n", opts.upload)
	logf("verifyTranslationUpToDate: %v\n", opts.verifyTranslationUpToDate)

	if opts.upload {
		ensureAllUploadCreds()
	}

	if opts.verifyTranslationUpToDate {
		verifyTranslationsMust()
	}
	if opts.doCleanCheck {
		panicIf(!isGitClean(""), "git has unsaved changes\n")
	}
	if opts.releaseBuild {
		verifyOnReleaseBranchMust()
		os.RemoveAll("out")
	}
}

func Main() {
	logf("Current directory: %s\n", currDirAbsMust())
	timeStart := time.Now()
	defer func() {
		logf("Finished in %s\n", time.Since(timeStart))
	}()

	// ad-hoc flags to be set manually (to show less options)
	var (
		flgBuildLzsa              = false
		flgFindLargestFilesByExt  = false
		flgGenTranslationsInfoCpp = false
		flgPrintBuildNo           = false
	)

	var (
		flgBuildLogview    bool
		flgBuildNo         int
		flgBuildSmoke      bool
		flgBuildCodeQL     bool
		flgCheckAccessKeys bool
		flgCIBuild         bool
		flgCIDailyBuild    bool
		flgClean           bool
		flgGenDocs         bool
		flgGenSettings     bool
		flgGenWebsiteDocs  bool
		flgRunTests        bool
		flgTransDownload   bool
		flgTriggerCodeQL   bool
		flgUpdateVer       string
		flgUpload          bool
		flgVerbose         bool
	)

	{
		flag.BoolVar(&flgCIBuild, "ci", false, "run CI steps")
		flag.BoolVar(&flgCIDailyBuild, "ci-daily", false, "run CI daily steps")
		flag.BoolVar(&flgBuildSmoke, "build-smoke", false, "run smoke build (installer for 64bit release)")
		flag.BoolVar(&flgBuildCodeQL, "build-codeql", false, "build for codeql")
		//flag.BoolVar(&flgBuildLzsa, "build-lzsa", false, "build MakeLZSA.exe")
		flag.BoolVar(&flgUpload, "upload", false, "upload the build to s3 and do spaces")
		flag.BoolVar(&flgTransDownload, "trans-dl", false, "download latest translations to translations/translations.txt")
		//flag.BoolVar(&flgGenTranslationsInfoCpp, "trans-gen-info", false, "generate src/TranslationLangs.cpp")
		flag.BoolVar(&flgClean, "clean", false, "clean the build (remove out/ files except for settings)")
		flag.BoolVar(&flgCheckAccessKeys, "check-access-keys", false, "check access keys for menu items")
		//flag.BoolVar(&flgPrintBuildNo, "build-no", false, "print build number")
		flag.BoolVar(&flgTriggerCodeQL, "trigger-codeql", false, "trigger codeql build")
		flag.BoolVar(&flgGenSettings, "gen-settings", false, "re-generate src/Settings.h")
		flag.StringVar(&flgUpdateVer, "update-auto-update-ver", "", "update version used for auto-update checks")
		flag.BoolVar(&flgRunTests, "run-tests", false, "run test_util executable")
		flag.BoolVar(&flgBuildLogview, "build-logview", false, "build logview-win. Use -upload to also upload it to backblaze")
		flag.IntVar(&flgBuildNo, "build-no-info", 0, "print build number info for given build number")
		flag.BoolVar(&flgGenDocs, "gen-docs", false, "generate html docs in docs/www from markdown in docs/md")
		flag.BoolVar(&flgGenWebsiteDocs, "gen-docs-website", false, "generate html docs in ../sumatra-website repo and check them in")
		flag.BoolVar(&flgVerbose, "verbose", false, "if true, verbose logging")
		flag.Parse()
	}

	if false {
		// for ad-hoc testing
		detectVersions()
		return
	}

	if false {
		genHTMLDocsForApp()
		// genTranslationInfoCpp()
		return
	}

	if flgGenDocs {
		genHTMLDocsForApp()
		return
	}

	if flgGenWebsiteDocs {
		genHTMLDocsForWebsite()
		return
	}

	if flgCheckAccessKeys {
		checkAccessKeys()
		return
	}

	if flgGenTranslationsInfoCpp {
		genTranslationInfoCpp()
		return
	}

	if flgBuildLzsa {
		buildLzsa()
		return
	}

	if flgBuildCodeQL {
		buildCodeQL()
		return
	}

	getSecrets()

	if flgTransDownload {
		downloadTranslations()
		return
	}

	detectVersions()

	if false {
		testCompressOneOff()
		if false {
			// avoid "unused function" warnings
			testGenUpdateTxt()
		}
		return
	}

	if flgBuildNo > 0 {
		printBuildNoInfo(flgBuildNo)
		return
	}

	if flgFindLargestFilesByExt {
		findLargestFileByExt()
		return
	}

	if flgBuildLogview {
		buildLogView()
		if flgUpload {
			uploadLogView()
		}
		return
	}

	opts := &BuildOptions{}

	if flgUpload {
		// given by me from cmd-line
		opts.upload = true
	}

	//opts.doCleanCheck = false // for ad-hoc testing

	ensureBuildOptionsPreRequesites(opts)

	if flgGenSettings {
		genAndSaveSettingsStructs()
		return
	}

	if flgTriggerCodeQL {
		triggerBuildWebHook(githubEventTypeCodeQL)
		return
	}

	if flgClean {
		cleanPreserveSettings()
		return
	}

	if flgBuildSmoke {
		buildSmoke(true)
		return
	}

	if flgPrintBuildNo {
		return
	}

	if flgCIDailyBuild {
		buildCiDaily()
		return
	}

	if flgCIBuild {
		detectLlvmPdbutil()
		buildCi()
		ensureAllUploadCreds()
		uploadPdbBuildArtifacts()
		return
	}

	if flgUpdateVer != "" {
		ensureAllUploadCreds()
		updateAutoUpdateVer(flgUpdateVer)
		return
	}

	if flgRunTests {
		buildTestUtil()
		dir := filepath.Join("out", "rel64")
		cmd := exec.Command(".\\test_util.exe")
		cmd.Dir = dir
		runCmdLoggedMust(cmd)
		return
	}

	flag.Usage()
}

func cmdRunLoggedInDir(dir string, args ...string) {
	cmd := exec.Command(args[0], args[1:]...)
	cmd.Dir = dir
	cmdRunLoggedMust(cmd)
}

var logViewWinDir = filepath.Join("tools", "logview")

func buildLogView() {
	ver := extractLogViewVersion()
	logf("biuldLogView: ver: %s\n", ver)
	os.RemoveAll(filepath.Join(logViewWinDir, "build", "bin"))
	//cmdRunLoggedInDir(".", "wails", "build", "-clean", "-f", "-upx")
	cmdRunLoggedInDir(logViewWinDir, "wails", "build", "-clean", "-f", "-upx")

	path := filepath.Join(logViewWinDir, "build", "bin", "logview.exe")
	panicIf(!u.FileExists(path))
	// signMust(path)
	logf("\n")
	printFileSize(path)
}

func extractLogViewVersion() string {
	path := filepath.Join(logViewWinDir, "frontend", "src", "version.js")
	d, err := os.ReadFile(path)
	must(err)
	d = u.NormalizeNewlinesInPlace(d)
	s := string(d)
	// s looks like:
	// export const version = "0.1.2";
	parts := strings.Split(s, "\n")
	s = parts[0]
	parts = strings.Split(s, " ")
	panicIf(len(parts) != 5)
	ver := parts[4] // "0.1.2";
	ver = strings.ReplaceAll(ver, `"`, "")
	ver = strings.ReplaceAll(ver, `;`, "")
	parts = strings.Split(ver, ".")
	panicIf(len(parts) < 2) // must be at least 1.0
	// verify all elements are numbers
	for _, part := range parts {
		n, err := strconv.ParseInt(part, 10, 32)
		panicIf(err != nil)
		panicIf(n > 100)
	}
	return ver
}

func printFileSize(path string) {
	size := u.FileSize(path)
	logf("%s: %s\n", path, u.FormatSize(size))
}

func printBuildNoInfo(buildNo int) {
	out := runExeMust("git", "log", "--oneline")
	lines := toTrimmedLines(out)
	// we add 1000 to create a version that is larger than the svn version
	// from the time we used svn
	n := len(lines) - (buildNo - 1000)
	s := lines[n]
	logf("%d: %s\n", buildNo, s)
}
