# Changelog

鎵€鏈夊€煎緱娉ㄦ剰鐨勫彉鏇撮兘璁板綍鍦ㄨ繖閲屻€?

鏍煎紡鍩轰簬 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)锛?
鐗堟湰鍙烽伒寰?[璇箟鍖栫増鏈琞(https://semver.org/lang/zh-CN/)銆?
`0.x.x` 鐗堟湰鍧囦负娴嬭瘯鐗堬紝鍦?GitHub Release 涓婅嚜鍔ㄦ爣璁颁负"棰勫彂甯?銆?

---

## [Unreleased]

> 在这里写下一个版本的更新内容，发版时会自动提取为 Release 正文。

### 新增

-

### 修复

-

### 变更

-

---

## [0.0.31-beta] - 2026-03-18

### 鏂板

- Startup pipeline now emits visible startup logs to the renderer via `gateway:log`.
- Added `pushGatewayLog` helper to actively push gateway/startup logs and keep the log buffer in sync.

### 淇

- Improved bundled OpenClaw startup observability for token init, port conflicts, dependency checks, and ready/timeout states.
- Added a top README warning banner clarifying the current unstable status of beta builds.

### 鍙樻洿

-

---

---

## [0.0.30-beta] - 2026-03-18

### 鏂板

- OpenClaw 鍐呮牳鍗囩骇鍖呮墦鍖呰剼鏈紙`pack-openclaw-upgrade`锛夊拰鍙戝竷鑴氭湰锛坄publish-openclaw-upgrade`锛?

### 淇

- 閲嶅啓 OpenClaw 鍐呮牳鍗囩骇娴佺▼锛氫粠 npm install 鏀逛负 GitHub Release zip 涓嬭浇瑙ｅ帇锛屽交搴曡В鍐虫棤澶栫綉鐜鍗囩骇澶辫触闂
- 淇 Gateway 鍋滄鏃?`stopGatewayGracefully` 鍙岄噸 resolve 绔炴€?
- 淇 `restartBundledGateway` 鏈娴嬭繘绋嬫彁鍓嶉€€鍑虹殑闂
- 淇 CommandDialog 寮规鏈眳涓樉绀?

---

---

## [0.0.29-beta] - 2026-03-18

### 淇

- 淇鍘嬬缉涓婁笅鏂囨彁绀轰竴鐩翠笉娑堝け鐨勯棶棰橈紙鏀逛负 10 绉掕嚜鍔ㄥ叧闂紝鏀寔鎵嬪姩鍏抽棴锛?

---

---

## [0.0.28-beta] - 2026-03-18

### 鏂板

- 鎶€鑳藉競鍦烘帴鍏?Skills.sh锛屾敮鎸佹祻瑙堢儹闂ㄦ妧鑳姐€佹悳绱㈠拰涓€閿畨瑁?
- 宸插畨瑁呮妧鑳藉垪琛ㄦ柊澧炴悳绱㈣繃婊ゅ姛鑳?
- 宸插畨瑁呮妧鑳借鎯呭脊绐楋紝鍙煡鐪嬫妧鑳芥枃浠跺強鍐呭
- 鑱婂ぉ娑堟伅鏀寔灞曠ず鎬濊€冭繃绋嬶紙thinking blocks锛夊拰宸ュ叿璋冪敤璇︽儏
- 鏂板鍘嗗彶浼氳瘽闈㈡澘锛屽彲娴忚鍜屽垏鎹㈣繃寰€浼氳瘽

### 淇

- 淇棣栨瀹夎鏃堕噸鍛藉悕榛樿 Agent 鎶ラ敊 `agent "main" not found`
- 淇鍐呯疆/bundled 鎶€鑳芥棤娉曟煡鐪嬫枃浠剁殑闂

### 鍙樻洿

- 鎶€鑳藉競鍦烘暟鎹簮浠?ClawHub API 杩佺Щ鑷?Skills.sh

---

---

## [0.0.27-beta] - 2026-03-17

### 淇

- 棣栨鍚姩璁剧疆瀹岀敤鎴蜂俊鎭悗锛屾ā鍨嬮厤缃楠ょ櫧灞忥紙onDone 寮曠敤涓嶇ǔ瀹?+ configured 鏃?return null锛?
- 娣诲姞 AppErrorBoundary 闃叉鏈崟鑾?React 閿欒瀵艰嚧鐧藉睆
- Dialog/Select 寮瑰嚭灞傚湪 onboarding 鎷栨嫿鍖哄煙鍐呯偣鍑绘棤鍝嶅簲锛圥ortal 鍐呭缂哄皯 no-drag锛?

### 鍙樻洿

-

---

---

## [0.0.26-beta] - 2026-03-17

### 鏂板

- ClawHub 鎶€鑳藉競鍦猴細娴忚銆佹悳绱€佷竴閿畨瑁呯ぞ鍖烘妧鑳斤紙鍩轰簬 `npx clawhub install`锛?
- 宸ヤ綔绌洪棿闈㈡澘瀹屾暣鏂囦欢鏍戯細閫掑綊鏄剧ず鎵€鏈夋枃浠?鏂囦欢澶癸紝鏀寔灞曞紑鎶樺彔
- 鏂囦欢鍙敤绯荤粺榛樿搴旂敤鎵撳紑锛堟偓鍋滄樉绀哄閮ㄩ摼鎺ユ寜閽級
- 寮曞娴佺▼鏂板妯″瀷閰嶇疆妫€娴嬫楠わ紝鏈厤缃椂鎻愮ず閰嶇疆鎴栬烦杩?
- 璁剧疆鎸夐挳鍙婃ā鍨嬮厤缃」绾㈢偣鎻愰啋锛堟湭閰嶇疆妯″瀷鏃舵樉绀猴級

### 淇

- 浼氳瘽鍒楄〃绌虹櫧闂儊闂
- gateway 浜嬩欢瀛楁鍏煎鎬э紙agentId fallback锛?

### 鍙樻洿

- i18n 绮剧畝锛氫粎淇濈暀绠€浣撲腑鏂囷紙zh-CN锛夊拰鑻辫锛坋n锛夛紝绉婚櫎鍏朵粬 8 绉嶈瑷€

---

---

## [0.0.25-beta] - 2026-03-16

### 鏂板

- 鏂板椋炰功 & Telegram 娓犻亾閰嶇疆椤甸潰锛屾敮鎸佸彲瑙嗗寲閰嶇疆 appId/appSecret/botToken 绛夊弬鏁?
- 鑱婂ぉ椤垫柊澧炲伐浣滃尯闈㈡澘锛圵orkspacePanel锛夛紝灞曠ず鏅鸿兘浣撴枃浠跺垪琛?
- Windows 绐楀彛鍏抽棴鎸夐挳澧炲姞浜屾纭寮圭獥锛岄槻姝㈣鍏?

### 淇

- 淇鏅鸿兘浣撹鎯呴潰鏉挎ā鍨嬫樉绀?鏈厤缃?锛氭敼鐢?openclawModelsGet API 鑾峰彇姝ｇ‘鐨勬ā鍨嬩俊鎭?
- 淇鏅鸿兘浣撹鎯呴潰鏉垮伐鍏峰垪琛ㄨ繃闀挎椂婧㈠嚭锛氭敼涓哄彲鎶樺彔灞曠ず锛堥粯璁ゆ樉绀哄墠 5 涓級
- 淇 OpenClaw 棣栨瀹夎鏃惰В鍘嬪仴澹€т笉瓒冲鑷?dist/entry.js 缂哄け
- 淇 macOS 绾㈢豢鐏寜閽笌鎼滅储鏍忛噸鍙?
- 淇鍚姩椤?loading spinner 鏃嬭浆鍋忓績

---

---

## [0.0.24-beta] - 2026-03-16

### 鏂板

- 鏅鸿兘浣撻厤缃柊澧炪€岃蹇嗐€嶆爣绛鹃〉锛屾敮鎸佹煡鐪?缂栬緫闀挎湡璁板繂锛圡EMORY.md锛夊拰娴忚姣忔棩璁板繂鏃ュ織
- 鏅鸿兘浣撲晶杈逛俊鎭潰鏉挎柊澧炶蹇嗘憳瑕佸睍绀?
- 鍚姩椤佃ˉ鍋垮姞杞芥覆鏌撳墠宸茶緭鍑虹殑 Gateway 鏃ュ織锛岄伩鍏嶆棩蹇椾涪澶?

### 鍙樻洿

- NSIS 瀹夎鍣ㄦ敼鐢?`nsExec::ExecToStack` 鏇夸唬 `ExecToLog`锛岄殣钘忓畨瑁呰鎯呴潰鏉匡紙nevershow锛夛紝浼樺寲瀹夎浣撻獙
- 瀹夎鍣ㄦā鏉胯緭鍑烘敼涓?UTF-8 BOM 缂栫爜锛屼慨澶?NSIS Unicode 妯″紡涓嬩腑鏂囦贡鐮?

---

---

## [0.0.23-beta] - 2026-03-15

### 鏂板

- 璁剧疆椤垫柊澧炪€孏ateway銆嶉厤缃潰鏉匡紝鏀寔閰嶇疆缃戝叧杩炴帴 URL 鍜岃闂护鐗?
- 鍏充簬椤甸潰鏂板 OpenClaw 鏇存柊闈㈡澘锛堜粠 OpenClaw 鐘舵€侀〉杩佺Щ锛?

### 淇

- 淇寮€鍙戞帶鍒跺彴涓枃鏃ュ織涔辩爜锛氫富杩涚▼鎵€鏈変腑鏂囨棩蹇楁秷鎭敼涓鸿嫳鏂囷紝閬垮厤 Windows GBK 缁堢缂栫爜涓嶅尮閰?
- 淇鍚姩鏃?Gateway 鏈氨缁嵆灏濊瘯杩炴帴浜х敓澶ч噺 ECONNREFUSED 閲嶈繛锛氭敼涓轰覆琛岀瓑寰?gateway 鍚姩瀹屾垚鍚庡啀鍚姩 runtime

### 鍙樻洿

- 绮剧畝 OpenClaw 鐘舵€侀〉锛氱Щ闄?AI 鍥㈤槦锛坅gent 鍒楄〃锛夐儴鍒嗭紝淇濈暀鏍稿績鐨勮繛鎺ョ姸鎬併€佺幆澧冧俊鎭拰鏃ュ織闈㈡澘
- 鍚姩鏃跺簭浼樺寲锛氶槻鐏瑙勫垯涓?OpenClaw 瑙ｅ帇鏀逛负骞惰鎵ц锛岀鍙ｆ帰娴嬩粠 1.5s 杞缂╃煭涓?300ms 鍗曟鎺㈡祴
- 鏈繛鎺?Gateway 鍓嶅缁堟樉绀哄搧鐗屽惎鍔ㄥ皝闈紙GatewayLoadingScreen锛夛紝涓嶅啀闂幇绌虹櫧鑱婂ぉ椤?

---

---

## [0.0.22-beta] - 2026-03-15

### 淇

- 淇 `openclaw-init.ts` 瑙ｅ帇 worker 鐨勭洰鏍囪矾寰勯敊璇細worker 鎺ユ敹鐨?`destDir` 浠嶄负 `resourcesPath` 鑰岄潪 `extractRoot`锛坲serData锛夛紝瀵艰嚧 zip 瑙ｅ帇鍒板畨瑁呯洰褰曡€岄潪鐢ㄦ埛鏁版嵁鐩綍

### 鍙樻洿

- 閲嶆瀯 OpenClaw 绋嬪簭鍐呭崌绾ф祦绋嬶細鏀逛负鐩存帴涓嬭浇 tarball锛圚TTP锛? 鍘熷瓙 rename 澶嶇敤鏃?node_modules + 澧為噺 npm install锛屽ぇ骞呯缉鐭崌绾ц€楁椂
- 鍗囩骇姝ラ浠?7 姝ョ簿绠€涓?5 姝ワ紙涓嬭浇 鈫?瀹夎 鈫?鍋滄 鈫?杩佺Щ 鈫?鍚姩锛夛紝鍓嶇杩涘害灞曠ず鍚屾鏇存柊
- 鎻愬彇 `src/main/lib/openclaw-paths.ts` 缁熶竴绠＄悊 OpenClaw 璺緞鏌ユ壘鍜屽叡浜父閲忥紝娑堥櫎涓夊閲嶅璺緞閫昏緫
- 淇 `ensureOpenclawDependencies` 涓娇鐢ㄥ悓姝?I/O锛坄readFileSync`/`writeFileSync`锛夐樆濉炰富杩涚▼浜嬩欢寰幆鐨勯棶棰?

---

---

## [0.0.21-beta] - 2026-03-15

### 淇

- 淇 OpenClaw 鍗囩骇杩囩▼涓垏鎹㈤〉闈㈠悗杩涘害鍜屾棩蹇楀叏閮ㄦ秷澶辩殑闂锛氫富杩涚▼鐜板湪鎸佷箙鍖栧崌绾ф瘡姝ョ殑鐘舵€佸拰鏃ュ織锛実ateway 杩涚▼杈撳嚭涔熺紦瀛樻渶杩?500 琛岋紝鍒囨崲鍥?OpenClaw 椤甸潰鏃惰嚜鍔ㄦ仮澶嶅畬鏁寸殑鍗囩骇杩涘害鍜屾棩蹇楅潰鏉?

---

---

## [0.0.20-beta] - 2026-03-15

### 淇

- 淇鍗囩骇 EasiestClaw 鏃舵瘡娆￠兘閲嶆柊瑙ｅ帇 OpenClaw 鐨勯棶棰橈細灏嗚В鍘嬬洰鏍囦粠瀹夎鐩綍锛坮esources/openclaw/锛夋敼涓虹敤鎴锋暟鎹洰褰曪紙AppData/EasiestClaw/openclaw/锛夛紝NSIS 鍗囩骇瀹夎涓嶄細娓呴櫎鐢ㄦ埛鏁版嵁鐩綍锛屽悓鐗堟湰 OpenClaw 鍙渶棣栨瀹夎鏃惰В鍘嬩竴娆?

---

---

## [0.0.19-beta] - 2026-03-15

### 淇

- 褰诲簳閲嶆瀯绋嬪簭鍐呭崌绾?OpenClaw 娴佺▼锛岀‘淇濆仴澹€э細涓嬭浇闃舵 gateway 缁х画杩愯锛堢敤鎴锋棤鎰熺煡锛夛紝涓嬭浇瀹屾垚鍚庢殏瀛樺埌鍚岀洏鐩綍锛岄獙璇侀€氳繃鍚庡啀鍋滄 gateway锛屾渶鍚庡師瀛?rename 瀹屾垚澶囦唤+杩佺Щ锛屽惎鍔ㄥけ璐ユ椂鑷姩鍥炴粴鑷虫棫鐗堟湰
- 淇鍗囩骇鏃?gateway 鍋滄鍚庣鍙ｆ湭瀹屽叏閲婃斁鍗冲紑濮嬫枃浠舵搷浣滅殑闂锛氭柊澧炰弗鏍肩鍙ｉ噴鏀剧瓑寰咃紙鏈€闀?15s锛夛紝瓒呮椂鍒欎腑姝㈠崌绾у苟鎭㈠ gateway
- 淇 gateway 杩涚▼閫€鍑轰簨浠剁珵鎬侊細鍗囩骇閲嶅惎鍦烘櫙涓嬫棫杩涚▼ exit 浜嬩欢涓嶅啀瑕嗙洊鏂拌繘绋嬪紩鐢紝閬垮厤瑙﹀彂铏氬亣鑷姩閲嶅惎瀵艰嚧绔彛鍐茬獊

---

## [0.0.18-beta] - 2026-03-15

### 淇

- 褰诲簳淇绋嬪簭鍐呭崌绾?OpenClaw 鍦?Windows 涓婂洜 git 鍛戒护澶辫触瀵艰嚧 npm install 鎶ラ敊锛圗NOENT/EINVAL锛夛細鏀逛负闅忓簲鐢ㄥ唴缃?MinGit锛圙it for Windows 鏈€灏忓垎鍙戯級锛岄€氳繃 `npm_config_git` 鎸囧悜鍐呯疆 `git.exe`锛屼笉鍐嶄緷璧栫郴缁?git 涔熶笉鍐嶄娇鐢ㄤ换浣?fake git 鑴氭湰

### 鍙樻洿

-

---

---

## [0.0.17-beta] - 2026-03-15

### 淇

- 褰诲簳淇绋嬪簭鍐呭崌绾?OpenClaw 鏃跺洜绯荤粺鏈畨瑁?git 瀵艰嚧 npm install 澶辫触锛圗NOENT锛夛細閲嶆柊寮曞叆 fake git 娉ㄥ叆鏈哄埗锛屽悓鏃堕€氳繃 PATH 鍓嶇疆鍜?npm_config_git 鐜鍙橀噺鍙岄噸淇濋殰锛岀‘淇?npm 10 鐨?git 鎺㈡祴涓嶄細涓柇瀹夎娴佺▼

---

---

## [0.0.16-beta] - 2026-03-15

### 淇

- 褰诲簳閲嶅啓 OpenClaw 绋嬪簭鍐呭崌绾х瓥鐣ワ細鏀逛负涓庢墦鍖呰剼鏈畬鍏ㄧ浉鍚岀殑鏈哄埗鈥斺€旂敤鍐呯疆 npm 鍦ㄤ复鏃剁洰褰曟墽琛?`npm install openclaw@version`锛坙ibsignal-node 鐢?stub override锛夛紝浠庢牴鏈笂瑙ｅ喅鏂板渚濊禆锛堝 `@modelcontextprotocol/sdk`锛夌己澶遍棶棰?
- 鏀硅繘鍚姩鏃朵緷璧栨鏌ワ細鏀逛负鐗堟湰鎰熺煡锛坥penclaw 鐗堟湰鍙樺寲鎵嶉噸璺?npm install锛夛紝鑰屼笉鏄€愬寘妫€鏌ワ紝閬垮厤妫€鏌ラ€昏緫閬楁紡鏈湪鏈湴 package.json 鍒楀嚭鐨勪緷璧?

### 鍙樻洿

-

---

---

## [0.0.15-beta] - 2026-03-15

### 淇

- 淇搴旂敤鍚姩鏃跺洜涓婃绋嬪簭鍐呭崌绾ф湭琛ュ叏渚濊禆瀵艰嚧 Gateway 鎶?ERR_MODULE_NOT_FOUND锛氬惎鍔ㄥ墠鑷姩妫€娴?node_modules 涓殑缂哄け鍖咃紝鏈夌己澶卞垯鍏堢敤鍐呯疆 npm 琛ヨ鍐?fork Gateway

### 鍙樻洿

-

---

---

## [0.0.14-beta] - 2026-03-15

### 淇

- 淇 OpenClaw 鍗囩骇鍚庢柊澧炰緷璧栵紙濡?@modelcontextprotocol/sdk锛夌己澶卞鑷?Gateway 鍚姩鎶?ERR_MODULE_NOT_FOUND锛氬崌绾ф椂鐢ㄥ唴缃?npm 琛ヨ鏂颁緷璧栵紝--omit=optional 璺宠繃 libsignal 绛?git URL 渚濊禆
- 淇 Release 姝ｆ枃涓嚭鐜扮┖鐨勩€屾柊澧炪€嶃€屽彉鏇淬€嶈妭锛氬彂鐗堝拰 CI 鎻愬彇鑴氭湰鐜板湪鑷姩杩囨护鍙湁鍗犱綅绗?`-` 鐨勭┖灏忚妭

### 鍙樻洿

-

---

---

## [0.0.13-beta] - 2026-03-15

### 淇

- 淇 OpenClaw 鍗囩骇鍚?Gateway 閲嶅惎瓒呮椂锛?0s 鈫?90s锛夛紝閬垮厤棣栨鍚姩闇€瑕?26s+ 鐨勬満鍣ㄥ崌绾у繀瀹氬け璐?
- 淇 Gateway 鍗囩骇閲嶅惎瓒呮椂琚鎶ヤ负鍗囩骇澶辫触锛涜秴鏃剁幇鍦ㄨ涓鸿蒋璀﹀憡锛屽崌绾ф甯稿畬鎴?
- 淇 Gateway 寮傚父閫€鍑猴紙code=0锛夊悗鏃犳硶鑷姩鎭㈠锛氭柊澧炴渶澶?5 娆¤嚜鍔ㄩ噸鍚紝闂撮殧 3s锛? 鍒嗛挓鏃犻噸鍚垯閲嶇疆璁℃暟

---

## [0.0.12-beta] - 2026-03-15

### 鏂板

- OpenClaw 椤甸潰鏂板銆孏ateway 杩愯鏃ュ織銆嶅崱鐗囷紝瀹炴椂鏄剧ず Gateway 杩涚▼杈撳嚭锛屾湁 stderr 鏃惰嚜鍔ㄥ睍寮€锛屾柟渚挎帓鏌ュ惎鍔ㄥけ璐ュ師鍥?

---

---

## [0.0.11-beta] - 2026-03-15

### 淇

- 淇绋嬪簭鍐呭崌绾?OpenClaw 鏃?npm install 璋冪敤 git 澶辫触鐨勯棶棰橈細鏀逛负鐩存帴澶嶇敤鐜版湁 node_modules锛屽交搴曠粫杩?git URL 渚濊禆闄愬埗
- 淇 release.mjs 鍙戠増鏃跺皢妯℃澘鎻愮ず琛岋紙`> 鍦ㄨ繖閲屽啓涓?..`锛夎褰撴湁鏁堝唴瀹瑰啓鍏ョ増鏈鏂?

---

---

## [0.0.10-beta] - 2026-03-15

### 淇

- 淇 OpenClaw 鍗囩骇鏃?fake git 涓嶇敓鏁堬紙git.cmd 璺緞鍚弻鍙嶆枩鏉犲鑷?ENOENT锛夛紝鍚屾椂琛ュ叏瀵?optionalDependencies 涓?git URL 渚濊禆鐨?stub 鏇挎崲
- 淇搴旂敤鏇存柊杩涘害鏉″崱鍦?0%锛坅vailable 鐘舵€佽鎻愬墠 unsubscribe锛屼笅杞戒簨浠舵敹涓嶅埌锛?
- 淇搴旂敤鏇存柊涓嬭浇鏃堕《閮?toast 涓庤缃〉杩涘害鏉￠噸澶嶆樉绀?

---

## [0.0.9-beta] - 2026-03-15

### 淇

- 褰诲簳淇 OpenClaw 鍗囩骇鏃跺洜绯荤粺鏈畨瑁?git 瀵艰嚧 npm install 澶辫触鐨勯棶棰橈細娉ㄥ叆涓存椂鐩綍鐨勫亣 git 鑴氭湰鍒?PATH锛屾嫤鎴?npm 瀵?git 鐨勬墍鏈夎皟鐢紙ls-remote/clone锛夛紝鍏ㄧ▼鏃犻渶绯荤粺 git
- 淇 macOS CI 鏋勫缓鍥犵己灏?`contents: write` 鏉冮檺瀵艰嚧 GitHub Release 涓婁紶 403 鎶ラ敊

---

## [0.0.8-beta] - 2026-03-14

### 鏂板

- 浣跨敤 Dexie.js (IndexedDB) 鏇挎崲 localStorage 鍥剧墖闄勪欢缂撳瓨锛屽瓨鍌ㄤ笂闄愪粠 5-10MB 鎻愬崌鑷?GB 绾э紝閲嶅惎搴旂敤鍚庡浘鐗囧彲鎭㈠

### 淇

- 淇 DM 瀵硅瘽涓彂閫佺殑鍥剧墖閲嶅惎鍚庢秷澶辩殑闂锛圤penClaw 128KB 闄愬埗瀵艰嚧鍘嗗彶璁板綍涓浘鐗囪鍓ョ锛?
- 淇鍥剧墖闄勪欢娣诲姞鍒拌緭鍏ユ鏃舵枃鏈尯鍩熻鍘嬬缉鑷虫瀬灏忛珮搴︾殑闂
- 淇 OpenClaw 鍗囩骇澶辫触鏃堕敊璇棩蹇楁秷澶便€佹棤娉曟帓鏌ュ師鍥犵殑闂锛涢暅鍍忔簮澶辫触鏃惰嚜鍔?fallback 鍒板畼鏂?npm 婧?
- 淇 NSIS 鍗囩骇瀹夎鏃跺脊鍑虹敤鎴锋暟鎹竻鐞嗙‘璁ゆ鐨勯棶棰?

### 鍙樻洿

- macOS 鏋勫缓绉婚櫎 Intel x64锛坢acOS 13锛夌増鏈紝浠呬繚鐣?Apple Silicon (arm64)

---

---

## [0.0.7-beta] - 2026-03-14

### 淇

- 淇 NSIS 鍗囩骇瀹夎鍚庡唴缃?OpenClaw 鏃犳硶鍚姩锛氱増鏈爣璁版畫鐣欎絾瑙ｅ帇鐩綍宸茶娓呴櫎锛岃烦杩囬€昏緫鏂板瀵瑰叆鍙ｈ剼鏈疄闄呭瓨鍦ㄧ殑鏍￠獙锛岀‘淇濈洰褰曠己澶辨椂閲嶆柊瑙ｅ帇

---

---

## [0.0.6-beta] - 2026-03-14

### 鏂板

- 鑱婂ぉ杈撳叆妗嗘敮鎸佹嫋鎷借皟鏁撮珮搴︼紝鏈€楂樹笉瓒呰繃瀵硅瘽妗嗙殑 1/3
- 鏂板鍋滄鐢熸垚鎸夐挳锛屽彲涓褰撳墠 AI 瀵硅瘽
- 杈撳叆妗嗘敮鎸佹枩鏉犲懡浠わ紙/command锛夎嚜鍔ㄨˉ鍏ㄦ彁绀?
- 娑堟伅鍙戦€侀槦鍒楋細AI 鐢熸垚涓彲棰勬帓鏈€澶?3 鏉℃秷鎭紝鐢熸垚缁撴潫鍚庤嚜鍔ㄤ緷娆″彂鍑?

### 淇

- 淇缃戝叧鍚姩鏃ュ織鍜岃В鍘嬫棩蹇椾腑 ANSI 棰滆壊杞箟鐮佹樉绀轰负涔辩爜鐨勯棶棰?
- 淇绐楀彛鏈€澶у寲鐘舵€佺洃鍚櫒鐨勫唴瀛樻硠婕忥紙useEffect cleanup 鍑芥暟鏈纭敞閿€锛?

### 鍙樻洿

- 绉婚櫎杈撳叆妗嗗伐鍏锋爮涓殑鏃犵敤鍗犱綅鎸夐挳锛堟牸寮忋€佸揩鎹锋寚浠ゃ€佹洿澶氥€佸睍寮€锛夊強鍒嗗壊绾?
- 鍚勫钩鍙板畨瑁呭寘鏂囦欢鍚嶇粺涓€瑙勮寖涓?`${productName}-Setup-${version}.${ext}` 鏍煎紡

---

---

## [0.0.5-beta] - 2026-03-14

### 鏂板

- 鍏充簬椤甸潰鏂板搴旂敤鏂囦欢澶广€佹暟鎹枃浠跺す銆佹棩蹇楁枃浠跺す灞曠ず锛屽甫涓€閿鍒跺拰鎵撳紑鍔熻兘

### 淇

- 淇 CI release 姝ｆ枃鏄剧ず涓?commit message 鑰岄潪 CHANGELOG 鍐呭锛?tmp 璺緞鍦?Windows runner 涓婁笉涓€鑷达紝鏀圭敤 $RUNNER_TEMP锛?
- 淇妫€鏌ユ洿鏂板け璐ワ紙v0.1.0 404锛夛細鍒犻櫎鏃╂湡娴嬭瘯閬楃暀鐨?v0.1.0 tag锛岃 tag 琚?electron-updater 璇垽涓烘渶鏂扮増

---

---

## [0.0.4-beta] - 2026-03-14

### 鏂板

- 璁剧疆椤垫柊澧炪€屽叧浜庛€嶉〉闈紝鏄剧ず搴旂敤鐗堟湰鍙凤紝鏀寔鎵嬪姩妫€鏌?涓嬭浇/瀹夎鏇存柊锛堝熀浜?GitHub Releases锛?

### 淇

- 淇鍐呯疆 OpenClaw 鍦ㄦ墦鍖呯増鏈腑鍗囩骇澶辫触锛欳I 鏈崋缁?npm锛岀幇宸茶ˉ鍏咃紙Windows: npm.cmd + node_modules/npm锛宮acOS: lib/node_modules/npm锛?
- 淇 CI electron-builder 鍥?publish 閰嶇疆灏濊瘯鑷姩涓婁紶瀵艰嚧缂哄皯 GH_TOKEN 鎶ラ敊锛堟敼鐢?`--publish never`锛?

### 鍙樻洿

- 鎵€鏈変笅鎷夋鏇挎崲涓?shadcn/ui Select 缁勪欢锛屽憡鍒師鐢熸牱寮?
- macOS CI 鏆傛椂鍏抽棴 tag 鑷姩瑙﹀彂锛屼粎淇濈暀鎵嬪姩瑙﹀彂锛坵orkflow_dispatch锛?

---

---

## [0.0.3-beta] - 2026-03-14

### 鏂板

- 搴旂敤鑷姩鏇存柊锛氶€氳繃 GitHub Releases 鑷姩妫€娴嬫柊鐗堟湰锛屽彂鐜版洿鏂板悗鏄剧ず Toast 閫氱煡锛屾敮鎸佷竴閿笅杞藉苟閲嶅惎瀹夎

### 淇

- CI锛氫慨澶?electron-builder 鍦?tag push 鏃跺洜缂哄皯 GH_TOKEN 瀵艰嚧鏋勫缓澶辫触锛堝姞 --publish never锛岀敱 softprops 缁熶竴涓婁紶锛?

---

## [0.0.2-beta] - 2026-03-14

### 鏂板

-

### 淇

-

### 鍙樻洿

-

---

## [0.0.1] - 2026-03-14

### 鏂板

- 鍝佺墝淇℃伅缁熶竴绠＄悊锛歚app.config.mjs` 浣滀负鍗曚竴閰嶇疆鍏ュ彛锛宍pnpm run brand` 鍚屾鍒版墍鏈夌浉鍏虫枃浠讹紙`src/shared/branding.ts`銆乣resources/installer.nsh`銆乣package.json`锛?
- 鏂板 `scripts/release.mjs`锛氫竴閿彂鐗堣剼鏈紝鑷姩澶勭悊 CHANGELOG銆乥umping 鐗堟湰鍙枫€乬it tag 鍜?push
- 鏂板 `scripts/extract-release-notes.mjs`锛氫粠 CHANGELOG.md 鎻愬彇鎸囧畾鐗堟湰鍐呭锛屼緵 CI 鍐欏叆 GitHub Release 姝ｆ枃
- CI 鑷姩灏?git tag 鐗堟湰鍙峰悓姝ュ埌 `package.json`锛岀‘淇濇墦鍖呬骇鐗╃増鏈纭?
- CI 鑷姩浠?CHANGELOG.md 鎻愬彇瀵瑰簲鐗堟湰鍐呭浣滀负 GitHub Release 姝ｆ枃
- `0.x.x` 鐗堟湰鍦?GitHub Release 涓婅嚜鍔ㄦ爣璁颁负棰勫彂甯冿紙娴嬭瘯鐗堬級
- Provider Card 鍐呰仈妯″瀷琛屾柊澧炶瑙夛紙Vision锛夊垏鎹㈡寜閽紝涓庣紪杈戝脊绐椾繚鎸佷竴鑷?
- API 鍋ュ悍妫€鏌ユ敼璧颁富杩涚▼ IPC 浠ｇ悊锛屾牴鎹?API 绫诲瀷鑷姩閫夋嫨姝ｇ‘璁よ瘉澶?

### 淇

- 淇妯″瀷閰嶇疆淇濆瓨鏃朵涪澶?`input` 瀛楁锛屽鑷村浘鐗囪瘑鍒缁堝け璐ョ殑闂
- 淇 API 鍋ュ悍妫€鏌ュ湪 renderer 鐩存帴 fetch 瑙﹀彂 CORS 鎶ラ敊
- 淇 Anthropic 绫诲瀷 API 浣跨敤 `Authorization: Bearer` 璁よ瘉澶达紙搴斾负 `x-api-key`锛?
- 淇鍋ュ悍妫€鏌ュ皢 HTTP 404 璇垽涓烘湇鍔′笉鍙揪锛坄/models` 绔偣涓嶅瓨鍦ㄤ笉绛変簬鏈嶅姟鎸備簡锛?

### 鍙樻洿

- `src/shared/branding.ts` 闆嗕腑绠＄悊搴旂敤鍚嶇О銆丄ppID 绛夊父閲忥紝main 杩涚▼鍜?renderer 缁熶竴寮曠敤
- `resources/installer.nsh` 鏀逛负浠?`installer.nsh.template` 妯℃澘鐢熸垚锛屼笉鍐嶆墜鍔ㄧ紪杈?

---

