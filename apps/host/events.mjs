import { WebSocketServer } from 'ws';
// WebSocket carries durable-event hints only. Clients always replay through HTTP.
export function attachEvents(server, store) {
  const wss = new WebSocketServer({ noServer:true, maxPayload:4096, perMessageDeflate:false });
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/live'||req.headers.origin){socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    let token=null;
    const timeout=setTimeout(()=>ws.close(1008,'authentication required'),5000);
    ws.on('message',raw=>{
      try {
        const message=JSON.parse(raw.toString());
        if(!token){if(message.type!=='authenticate'||!store.member(message.token))return ws.close(1008,'authentication failed');token=message.token;clearTimeout(timeout);ws.send(JSON.stringify({type:'ready',room_id:store.get('room_id')}));}
        else if(message.type==='ping')ws.send(JSON.stringify({type:'pong'}));
      }catch{ws.close(1008,'invalid message');}
    });
    const interval=setInterval(()=>{
      if(!token||ws.readyState!==1)return;
      if(!store.member(token))return ws.close(1008,'identity revoked');
      const seq=store.db.prepare('SELECT COALESCE(MAX(seq),0) seq FROM events').get().seq;
      if(ws.bufferedAmount>65536)return ws.close(1013,'slow client');
      ws.send(JSON.stringify({type:'cursor',seq}));
    },1000);
    ws.on('error',()=>{});ws.on('close',()=>{clearTimeout(timeout);clearInterval(interval);});
  });
  return {disconnectClients(){for(const ws of wss.clients)ws.terminate();},close(){for(const ws of wss.clients)ws.terminate();wss.close();}};
}
