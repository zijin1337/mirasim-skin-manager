/* Errands you can send her on — right-click the pet.
 *
 * Edit this list freely; it is data, not code. Each entry:
 *
 *   label    what the menu says
 *   prompt   what the agent is actually asked to do
 *   workdir  optional — where it runs. Omitted means "wherever you were last
 *            working", resolved from the most recently active session.
 *   safe     true skips the confirmation. Only mark an errand safe when its
 *            prompt is fixed and read-only; anything that can change files or
 *            run commands should make you confirm.
 *
 * A .js file rather than .json because the app's renderer is a file:// page,
 * and a file:// page cannot fetch local JSON — the same reason the skin
 * manifest is manifest.js.
 */
window.__cloveErrands = [
  {
    label: '仓库现在什么样',
    prompt: '汇报这个仓库未提交的改动和最近三个提交，三句话说完。只读，不要修改任何文件。',
    safe: true,
  },
  {
    label: '皮肤自检',
    prompt: [
      '检查 Mirasim 皮肤管理器是否健康，只读，不要修改任何文件。报告四件事：',
      '1) app.asar 里有没有 mirasim-skinmgr-loader.js；',
      '2) ~/.mirasim/app/state.json 的 good 指向哪个版本，那个目录的 renderer/index.html 有没有 loader；',
      '3) ~/.mirasim/skins/ 下有哪些皮肤，_shared/agent-bridge.js 在不在；',
      '4) work/mirasim-skins/autosync.log 最后一条说了什么。',
      '每条一行，直接给结论。',
    ].join('\n'),
    workdir: 'C:\\Users\\31394\\Documents\\ChatGPT\\Mirasim',
    safe: true,
  },
  {
    label: '今天我改了什么',
    prompt: '汇总今天这个仓库的提交，每条一句话。只读，不要修改任何文件。',
    safe: true,
  },
];
