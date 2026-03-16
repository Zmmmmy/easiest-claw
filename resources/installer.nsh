; installer.nsh — 天工AI 自定义 NSIS 安装钩子
; 在安装/卸载时自动添加/删除 Windows Defender 防火墙规则，
; 避免用户首次启动时收到"是否允许连接网络"的拦截弹窗。
; ⚠️  此文件由 scripts/apply-branding.mjs 从 installer.nsh.template 自动生成，请勿直接编辑。

; 安装详情面板默认展开，用户无需手动点击 "Details" 按钮
; 通过 MUI_PAGE_CUSTOMFUNCTION_SHOW 在安装页面显示时写入提示文字，
; 因为 electron-builder 的 installSection.nsh 会在 section 开头设 SetDetailsPrint none，
; 但 SHOW 回调在 section 执行前触发，此时写入的文字会保留在日志面板中。
!macro customHeader
  ShowInstDetails nevershow
  ShowUnInstDetails show
!macroend

!macro customInstall
  SetDetailsPrint both
  DetailPrint "程序文件安装完成。"
  DetailPrint "正在配置 Windows 防火墙规则..."
  DetailPrint "删除旧规则（如存在）..."
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="天工AI"'
  Pop $0
  DetailPrint "添加入站规则（TCP 18789）..."
  nsExec::ExecToStack 'netsh advfirewall firewall add rule name="天工AI" dir=in action=allow program="$INSTDIR\TianGong.exe" enable=yes'
  Pop $0
  DetailPrint "防火墙规则配置完成。"
!macroend

!macro customUnInit
  SetDetailsPrint both
  DetailPrint "正在准备卸载..."
!macroend

; 卸载时跳过逐文件原子操作（openclaw node_modules 文件极多，会导致卸载极慢），
; 直接批量删除整个安装目录
!macro customRemoveFiles
  SetDetailsPrint both
  DetailPrint "正在删除程序文件，请稍候..."
  SetDetailsPrint none
  RMDir /r $INSTDIR
  SetDetailsPrint both
  DetailPrint "程序文件删除完成。"
!macroend

!macro customUnInstall
  SetDetailsPrint both
  DetailPrint "正在移除 Windows 防火墙规则..."
  nsExec::ExecToStack 'netsh advfirewall firewall delete rule name="天工AI"'
  Pop $0
  DetailPrint "防火墙规则已移除。"

  ; 升级安装时，新安装包会静默（/S）调用旧版卸载程序，此时跳过用户数据清理弹窗
  IfSilent done

  ; 手动卸载时才询问用户是否同时清除 AppData 中的用户设置与数据
  MessageBox MB_YESNO|MB_ICONQUESTION \
    "是否同时删除 天工AI 的用户设置和缓存数据？$\n$\n\
选择「是」将彻底清除（AppData\Roaming\TianGong），$\n\
选择「否」则保留，重新安装后可自动恢复设置。" \
    IDNO done
  RMDir /r "$APPDATA\TianGong"
  DetailPrint "用户数据已清除。"
  done:
!macroend
