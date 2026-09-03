$p = Start-Process -FilePath 'node' -ArgumentList 'scripts/test-phase7.js','--skip-child-suites' -RedirectStandardOutput '_p7.log' -RedirectStandardError '_p7.err' -NoNewWindow -PassThru
Write-Host 'Started PID' $p.Id
Start-Sleep 35
if($p.HasExited) {
  Write-Host 'EXITED:' $p.ExitCode
} else {
  Write-Host 'STILL RUNNING — killing'
  Stop-Process $p.Id -Force
}
Get-Content '_p7.log' -ErrorAction SilentlyContinue
Write-Host '--- STDERR ---'
Get-Content '_p7.err' -ErrorAction SilentlyContinue
