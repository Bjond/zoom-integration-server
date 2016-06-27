/*  Simple Socket.io message handling server
 *  Carl-Philip Majgaard
 *  cp.majgaard@bjondinc.com
 */

var http = require('http');
var express = require("express");
var request = require('request');
var app = express();

var key = process.env.ZOOM_KEY;
var secret = process.env.ZOOM_SECRET;

var server = http.createServer(app);
var io = require('socket.io').listen(server);
var fs = require('fs');

server.listen(27000);

// routing
app.get('/zoomtest', function (req, res) {
  res.sendfile(__dirname + '/chat.html');
});

app.get('/dist/sweetalert.min.js', function (req, res) {
  res.sendfile(__dirname + '/dist/sweetalert.min.js');
});

app.get('/dist/sweetalert.css', function (req, res) {
  res.sendfile(__dirname + '/dist/sweetalert.css');
});

sockets = {};
statuses = {};
activeRequests = {};

function s4() {
  return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
}

function ruid(){
  rid = (s4() + s4() + "-" + s4() + "-4" + s4().substr(0,3) + "-" + s4() + "-" + s4() + s4() + s4()).toLowerCase();
  if(activeRequests.hasOwnProperty(rid)){
    return ruid();
  }
  else{
    return rid;
  }
}

function updateSockets(){
  list = [];
  for(var user in statuses){
    if(statuses[user] === 'online'){
      list.push(user);
    }
  }

  for(var key in sockets){
    for(var sock in sockets[key]){
      sockets[key][sock].emit('updateList', list);
    }
  }
}

//custCreates a user, if succesful, then calls createIM
function custCreate(email, hostSocket, keys){
  request({
    uri: "https://api.zoom.us/v1/user/custcreate",
    method: "POST",
    form: {
      api_key: key,
      api_secret: secret,
      email: email,
      type: 2
    }
  }, function(error, response, body) {
    if(!error && response.statusCode === 200){
      jbody = JSON.parse(body);
      createIM(jbody["id"], hostSocket, keys)
    }
    else{
      return 'error';
      console.log(body);
    }
  });
}

//Creates IM and if succesful, distrutes links to sockets.
function createIM(hostID, hostSocket, keys){
  request({
    uri: "https://api.zoom.us/v1/meeting/create",
    method: "POST",
    form: {
      api_key: key,
      api_secret: secret,
      host_id: hostID,
      topic: "Bjönd Secure Meeting",
      type: 1
    }
  }, function(error, response, body) {
    if(!error && response.statusCode === 200){
      var jbody = JSON.parse(body);
      var zoomIDs = {start: jbody["start_url"], join: jbody["join_url"]};
      distributeRoom(zoomIDs, hostSocket, keys);
    }
    else{
      return 'error';
      console.log(body);
    }
  });
}

function spawnRoom(email, hostSocket, keys){
  custCreate(email, hostSocket, keys);
}

function distributeRoom(zoomIDs, socket, keys){
  clearRequest(keys.rid);
  console.log(zoomIDs);
  socket.emit('acceptSucceed', zoomIDs.start);

  setTimeout(distributeRoom2(zoomIDs, hostSocket, keys), 3500)

}

function distributeRoom2(zoomIDs, hostSocket, keys){
  var originSocketFound = false;
  for(var openSocket in sockets[keys.origin]){
    if(sockets[keys.origin][openSocket].id === activeRequests[keys.rid].originSocket){
      sockets[keys.origin][openSocket].emit('requestAccepted', socket.uuid, zoomIDs.join);
      originSocketFound = true;
    }
  }

  if(originSocketFound === false){
    sockets[keys.origin][0].emit('requestAccepted', socket.uuid, zoomID);
  }

  //This will close incomingCall notifs in other windows
  for(var openSocket in sockets[socket.uuid]){
    if(sockets[socket.uuid][openSocket].id !== socket.id){ //All sockets but the one accepting
      sockets[socket.uuid][openSocket].emit('closeIncomingCall');
    }
  }
}

function clearRequest(rid){
    delete activeRequests[rid];
}

io.sockets.on('connection', function (socket) {

	//When the client connects, they should join the pool
	socket.on('join', function(uuid){
		//We store their UUID in the socket instance
		socket.uuid = uuid;
    //If they don't have any open Sockets
    //Set them up with a spot in the dictionary
    if (typeof sockets[uuid] === 'undefined') {
        sockets[uuid]=[];
    }
    sockets[uuid].push(socket);

    if(sockets[uuid].length === 1){
      socket.emit('goOnline');
      statuses[uuid] = 'online';
      updateSockets();
    }

    //If they are currently online somewhere else,
    //Tell this socket to go online
    else if(statuses[uuid] === 'online'){
      socket.emit('goOnline');
    }
    else{
      socket.emit('goOffline');
    }
	});

  //When they leave the pool, remove the socket.
  socket.on('leave', function(){
    var index = sockets[socket.uuid].indexOf(socket);

    if(index > -1){
      sockets[socket.uuid].splice(index, 1);
    }

    if(sockets[socket.uuid].length === 0){
      statuses[socket.uuid] = 'offline';
    }
    updateSockets();
  });

  //When user sets their online status, echo it to their other sockets
  socket.on('setOnline', function(){
    statuses[socket.uuid] = 'online';
    for(var openSocket in sockets[socket.uuid]){
      sockets[socket.uuid][openSocket].emit('goOnline');
    }
    updateSockets();
  });

  //When user sets their offline status, echo it to their other sockets.
  socket.on('setOffline', function(){
    statuses[socket.uuid] = 'offline';
    for(var openSocket in sockets[socket.uuid]){
      sockets[socket.uuid][openSocket].emit('goOffline');
    }
    updateSockets();
  });

	// when the user disconnects, remove the socket
	socket.on('disconnect', function(){
    var index = sockets[socket.uuid].indexOf(socket);

    if(index > -1){
      sockets[socket.uuid].splice(index, 1);
    }

    if(sockets[socket.uuid].length === 0){
      statuses[socket.uuid] = 'offline';
      for(var key in activeRequests){
        if(activeRequests[key].origin === socket.uuid){
          clearRequest(key);
          console.log("Deleted " + key);
        }
      }
    }
    updateSockets();
	});

  //Takes an array of UUIDs and returns online status as an array
  socket.on('getOnline', function(targets){
    var response = {};

    for(var user in targets){
      response[targets[user]] = (sockets[targets[user]] !== 'undefined' && statuses[targets[user]] === 'online');
    }

    socket.emit('isOnline', response);
  });

  //When a user sends a Call request, forward it to the destination if
  //they are online
	socket.on('sendRequest', function(destination){
    if(sockets[destination] === 'undefined' || statuses[destination] !== 'online'){
      socket.emit('requestFailed', 'User is Offline / Does not Exist');
      return;
    }
    else if (destination === socket.uuid) {
      socket.emit('requestFailed', "You can't call yourself. Don't be weird.");
      return;
    }

    for(var key in activeRequests){
      if(activeRequests[key].origin === socket.uuid){
        socket.emit('requestFailed', "Cannot initiate multiple calls at the same time.");
        console.log("User is active in RID " + key);
        console.log(activeRequests[key]);
        return;
      }
      else if(activeRequests[key].destination === destination){
        socket.emit('requestFailed', "User is Busy.");
        return;
      }
    }

    var rid = ruid();
    activeRequests[rid] = {
      'origin': socket.uuid,
      'originSocket': socket.id,
      'destination': destination
    };
    console.log(activeRequests[rid]);
    console.log(rid);

    socket.emit('ringing', destination, rid);

    for(var openSocket in sockets[destination]){
      sockets[destination][openSocket].emit('incomingRequest', socket.uuid, rid);
    }
  });

  //When a user accepts an incoming call
  //tell the origin that it was accepted
  socket.on('tryAccept', function(keys){
    try{
      if(activeRequests[keys.rid].origin === keys.origin && activeRequests[keys.rid].destination === socket.uuid){
        console.log(sockets[keys.origin]);
        if(sockets[keys.origin] === 'undefined' || sockets[keys.origin].length === 0){
          console.log("acceptFail triggered");
          socket.emit('requestFailed', 'User disconnected');
          //This will close incomingCall notifs in other windows
          for(var openSocket in sockets[socket.uuid]){
            if(sockets[socket.uuid][openSocket].id !== socket.id){ //All sockets but the one accepting
              sockets[socket.uuid][openSocket].emit('closeIncomingCall');
            }
          }
          clearRequest(keys.rid);
          return;
        }

        for(var openSocket in sockets[keys.origin]){
          if(sockets[keys.origin][openSocket].id === activeRequests[keys.rid].originSocket){
            sockets[keys.origin][openSocket].emit('connecting');
          }
        }

      spawnRoom(socket.uuid, socket, keys);
      }
      else{
        socket.emit('requestFailed', 'Invalid Key Pair');
      }
    }
    catch (e){
      socket.emit('requestFailed', 'Invalid Key Pair.');
      console.log(e);
    }
  });

  socket.on('cancelRequest', function(keys){
    try{
      console.log(keys.rid);
      console.log(activeRequests[keys.rid]);
      if(activeRequests[keys.rid].origin === socket.uuid && activeRequests[keys.rid].destination === keys.destination){
        for(var openSocket in sockets[keys.destination]){
          sockets[keys.destination][openSocket].emit('closeIncomingCall');
          console.log("closed");
        }
        clearRequest(keys.rid);
      }
      else{
        console.log("mismatch");
      }
    }
    catch (e){
      socket.emit('requestFailed', 'Invalid Key Pair.');
      console.log(e);
    }
  });

  socket.on('denyRequest', function(keys){
    try{
      if(activeRequests[keys.rid].origin === keys.origin && activeRequests[keys.rid].destination === socket.uuid){
        if(sockets[keys.origin] === 'undefined' || sockets[keys.origin].length === 0){
          console.log("denyFail triggered");
          //This will close incomingCall notifs in other windows
          for(var openSocket in sockets[socket.uuid]){
            if(sockets[socket.uuid][openSocket].id !== socket.id){ //All sockets but the one accepting
              sockets[socket.uuid][openSocket].emit('closeIncomingCall');
            }
          }
          clearRequest(keys.rid);
          return;
        }
        var originSocketFound = false;
        for(var openSocket in sockets[keys.origin]){
          if(sockets[keys.origin][openSocket].id === activeRequests[keys.rid].originSocket){
            sockets[keys.origin][openSocket].emit('requestDenied', socket.uuid);
            originSocketFound = true;
          }
        }

        if(originSocketFound === false){
          sockets[keys.origin][0].emit('requestDenied', socket.uuid);
        }
        //This will close incomingCall notifs in other windows
        for(var openSocket in sockets[socket.uuid]){
          if(sockets[socket.uuid][openSocket].id !== socket.id){ //All sockets but the one accepting
            sockets[socket.uuid][openSocket].emit('closeIncomingCall');
          }
        }
        clearRequest(keys.rid);
      }
    }
    catch (e){
      socket.emit('requestFailed', 'Invalid Key Pair.');
      console.log(e);
    }
  });

  socket.on('closeOthers', function(){
    for(var openSocket in sockets[socket.uuid]){
      if(sockets[socket.uuid][openSocket].id !== socket.id){ //All sockets but the one requesting
        sockets[socket.uuid][openSocket].emit('closeAlerts');
      }
    }
  });

});
