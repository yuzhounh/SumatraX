package do

import (
	"flag"
	"os"
	"path/filepath"
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
		flgGenDocs     bool
		flgGenSettings bool
		flgUpload      bool
		flgVerbose     bool
	)

	{
		//flag.BoolVar(&flgBuildLzsa, "build-lzsa", false, "build MakeLZSA.exe")
		flag.BoolVar(&flgUpload, "upload", false, "upload the build to s3 and do spaces")
		//flag.BoolVar(&flgGenTranslationsInfoCpp, "trans-gen-info", false, "generate src/TranslationLangs.cpp")
		//flag.BoolVar(&flgPrintBuildNo, "build-no", false, "print build number")
		flag.BoolVar(&flgGenSettings, "gen-settings", false, "re-generate src/Settings.h")
		flag.BoolVar(&flgGenDocs, "gen-docs", false, "generate html docs in docs/www from markdown in docs/md")
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

	if flgGenTranslationsInfoCpp {
		genTranslationInfoCpp()
		return
	}

	if flgBuildLzsa {
		buildLzsa()
		return
	}

	getSecrets()

	detectVersions()

	if false {
		testCompressOneOff()
		if false {
			// avoid "unused function" warnings
			testGenUpdateTxt()
		}
		return
	}

	if flgFindLargestFilesByExt {
		findLargestFileByExt()
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

	if flgPrintBuildNo {
		return
	}

	flag.Usage()
}
