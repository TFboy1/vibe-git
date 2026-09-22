export function startLive(client,wake) {
  let socket=null,stopped=false,retry=null,heartbeat=null,lastMessage=0;
  function connect(){
    if(stopped)return;const binding=client.get('binding');
    if(!binding){retry=setTimeout(connect,1000);return;}
    const url=new URL('/api/live',binding.host);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    socket=new WebSocket(url);const connection=socket;
    connection.onopen=()=>{lastMessage=Date.now();connection.send(JSON.stringify({type:'authenticate',token:binding.token}));};
    connection.onmessage=e=>{lastMessage=Date.now();try{const message=JSON.parse(e.data);if(message.type==='ready'){if(message.room_id!==binding.room_id){connection.close();return;}client.liveConnected=true;wake();}if(message.type==='cursor'&&message.seq>(client.get('cursor')||0))wake();}catch{connection.close();}};
    connection.onerror=()=>{};
    connection.onclose=()=>{client.liveConnected=false;clearInterval(heartbeat);if(!stopped)retry=setTimeout(connect,3000);};
    heartbeat=setInterval(()=>{if(Date.now()-lastMessage>20000){connection.close();return;}if(connection.readyState===1)connection.send(JSON.stringify({type:'ping'}));},5000);
  }
  connect();return ()=>{stopped=true;clearTimeout(retry);clearInterval(heartbeat);socket?.close();};
}
