package do

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	apptranslatoServer  = "https://www.apptranslator.org"
	translationsDir     = "translations"
	translationsTxtPath = filepath.Join(translationsDir, "translations.txt")
)

func getTransSecret() string {
	panicIf(transUploadSecret == "", "must set TRANS_UPLOAD_SECRET env variable or in .env file")
	return transUploadSecret
}

func downloadTranslationsMust() []byte {
	timeStart := time.Now()
	defer func() {
		fmt.Printf("downloadTranslations() finished in %s\n", time.Since(timeStart))
	}()
	strs := extractStringsFromCFilesNoPaths()
	sort.Strings(strs)
	fmt.Printf("uploading %d strings for translation\n", len(strs))
	secret := getTransSecret()
	uri := apptranslatoServer + "/api/dltransfor?app=SumatraPDF&secret=" + secret
	s := strings.Join(strs, "\n")
	body := strings.NewReader(s)
	req, err := http.NewRequest(http.MethodPost, uri, body)
	must(err)
	client := http.DefaultClient
	rsp, err := client.Do(req)
	must(err)
	panicIf(rsp.StatusCode != http.StatusOK)
	d, err := io.ReadAll(rsp.Body)
	must(err)
	return d
}
