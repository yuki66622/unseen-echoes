// The published game protocol keeps its English IDs and server messages.
// Translate only the presentation layer; never send these labels as role IDs.
const ROLES=Object.freeze({hunter:'监管者',survivor:'求生者'});
const OUTCOMES=Object.freeze({
  captured:'监管者抓住了求生者，本局结束。',
  escaped:'求生者找到了老式电机，并从出口成功逃脱。',
  timeout:'追逐时间已到，监管者获胜。',
  abandoned:'有玩家离开，对局已结束。',
  interrupted:'有玩家未能及时重新连接，对局已结束。',
});

export const MESSAGE_ZH=Object.freeze({
  'Room code must contain six uppercase letters or digits.':'房间码需要由 6 位英文字母或数字组成。',
  'Player name must contain 1 to 32 characters without control characters.':'名字需要为 1 至 32 个字符，不能包含换行等控制字符。',
  'An active game connection is required.':'尚未连接游戏，请等待连接恢复。',
  'Join a room first.':'请先创建或加入一个房间。',
  'Only the chase uses a multiplayer room.':'双人房间用于第一关追逐。',
  'Leave your current room first.':'请先离开当前房间，再加入另一个房间。',
  'Room code is already in use.':'这个房间码已被使用，请重新创建房间。',
  'Room is unavailable.':'房间不存在或已经开始，请检查房间码并让朋友确认房间状态。',
  'Room is full.':'房间已满，每个房间最多两人。',
  'Roles can only change in the lobby.':'只能在房间准备阶段更换角色。',
  'Choose hunter or survivor.':'请选择监管者或求生者。',
  'The other player has selected that role.':'朋友已经选择了这个角色，请选择另一个。',
  'Readiness can only change in the lobby.':'只能在房间准备阶段修改准备状态。',
  'Select a role before becoming ready.':'请先选择角色，再点击“准备好了”。',
  'A restart vote is only available after the round.':'本局结束后才能申请再玩一局。',
  'Both players must be present to restart.':'两位玩家都在线并选择不同角色后，才能再玩一局。',
  'The chase is not running.':'追逐尚未开始，或本局已经结束。',
  'Only the server may advance a round.':'当前操作不可用，请等待对局更新。',
  'A round requires two online players with different roles.':'两位玩家都在线，并选择不同角色后才能开始。',
  'Wait for the head start, then listen for the survivor heartbeat.':'等待求生者先行时间结束，再循着心跳声追捕。',
  'Find the key by the birds, then reach the rain beyond the door.':'在鸟鸣处寻找钥匙，再前往门后的雨声处。',
  'You are not a player in this round.':'你不在本局中，请重新加入房间。',
  'Invalid server time.':'对局时间暂时无法同步，请等待连接恢复。',
  'You reached the edge of the play area.':'已到达场地边缘，可以转身继续探索。',
  'The way is blocked.':'前方被挡住了。',
  'Both players are back. The chase has resumed.':'两位玩家均已重新连接，追逐继续。',
  'Input sequence must be an unsigned 32-bit integer starting at one.':'操作顺序无法确认，请等待同步后重试。',
  'Unknown input command.':'暂不支持这个操作。',
  'This input belongs to a different round.':'这条操作来自上一局，已忽略，请在当前对局中重试。',
  'Input sequence has already been processed.':'这条操作已经处理，请继续下一步。',
  'The round has ended.':'本局已经结束。',
  'The chase is paused while a player reconnects.':'追逐已暂停，正在等待另一位玩家重新连接。',
  'The survivor still has a head start.':'求生者仍在先行时间内，请稍候再行动。',
  'Move closer to the door.':'请再靠近门一点。',
  'The doorway is occupied.':'有人站在门口，暂时无法关门。',
  'The door is open.':'门已打开。',
  'The door is closed.':'门已关闭。',
  'Open the exit door before escaping.':'打开出口，设法逃脱。',
  'Find the old motor, then reach the rain at the exit.':'循着电机声音寻找出口。',
  'Find the old motor and interact to inspect it.':'循着机械运转声找到老式电机。',
  'You found the old motor. Reach the rain at the exit.':'找到了老式电机。循着电机声音寻找出口。',
  'The old motor is not within reach.':'老式电机还不在附近，继续循声寻找。',
  'Reach the rain and interact to escape.':'循着电机声音找到出口，设法逃脱。',
  'You found the key. Reach the rain beyond the door.':'你找到了钥匙，现在前往门后的雨声处。',
  'No survivor within reach.':'求生者还不在可抓捕的范围内。',
  'The exit is not within reach.':'你还没有靠近出口。',
  'The key is not within reach.':'你还没有靠近钥匙。',
  'Listen for the survivor heartbeat. Get close and interact to catch the survivor.':'循着心跳声接近求生者，尝试抓捕。',
  'Reach the rain beyond the door and interact to escape.':'循着电机声音寻找出口。',
  'Find the birds and interact to collect the key.':'循着鸟鸣寻找钥匙。',
  'The chase ended because a player could not reconnect.':'有玩家未能及时重新连接，追逐已结束。',
  'A player left the chase.':'有玩家离开了追逐。',
  'Connecting…':'正在连接……',
  'Reconnecting…':'正在重新连接……',
  'Connected':'已连接',
  'Connection lost. Movement stopped; reconnecting…':'连接中断，已停止移动，正在重新连接……',
  'Room subscription failed. Reconnecting…':'房间同步失败，正在重新连接……',
  'Wait for the connection to recover.':'请等待连接恢复后再操作。',
  'The connection changed. Please try again.':'连接已更新，请重试。',
  'Connection lost. The action could not be confirmed.':'连接已中断，暂时无法确认刚才的操作。',
  'The action could not be confirmed in time. Please check the game state before trying again.':'操作确认超时，请先查看当前游戏状态，再决定是否重试。',
  'The connection was closed.':'连接已关闭。',
  'Local service unavailable':'游戏服务暂时不可用，请稍后重试。',
  'Failed to fetch':'网络请求失败，请检查连接后重试。',
  'Load failed':'加载失败，请检查连接后重试。',
  'NetworkError when attempting to fetch resource.':'网络请求失败，请检查连接后重试。',
  'WebSocket error':'游戏连接中断，正在尝试恢复。',
  'Request origin is not allowed.':'当前游戏入口不可用，请使用提供的游戏地址重新打开。',
  'Reload the game to renew this session.':'连接凭证已更新，请刷新游戏后重试。',
  'Not found.':'没有找到所需页面，请确认游戏入口地址。',
  'JSON required.':'消息格式不正确，请重试。',
  'Request is too large or empty.':'消息过长或为空，请缩短内容后重试。',
  'Two conversations are in progress. Try again shortly.':'对话服务正在处理其他请求，请稍后重试。',
  'Message format is invalid.':'消息格式不正确，请重新输入。',
  'The conversation could not be completed. Your game is still available.':'对话暂时未完成，你仍可继续探索。',
  'Conversation service is unavailable.':'对话服务暂时不可用，你仍可继续探索。',
  'Conversation failed.':'对话暂时未完成，请稍后重试。',
});

export const roleLabel=role=>ROLES[role]||'尚未选择角色';
export const outcomeLabel=outcome=>OUTCOMES[outcome]||'这一段追逐已经结束。';

export function localizeMessage(value,fallback='操作暂时未完成，请稍后重试。'){
  const text=String(value??'').trim().replace(/^(?:SenderError|InternalError|Error):\s*/, '');
  if(!text)return '';
  if(Object.hasOwn(MESSAGE_ZH,text))return MESSAGE_ZH[text];
  const paused=text.match(/^Chase paused\. Waiting for reconnection \((\d+)s\)\.$/);
  if(paused)return `追逐已暂停，等待重新连接（还剩 ${paused[1]} 秒）。`;
  // Preserve messages already translated by the local service. Unknown browser
  // and provider errors get a readable recovery message, not raw English.
  return /[\u3400-\u9fff]/u.test(text)?text:fallback;
}
