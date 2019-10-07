var express = require('express');
var socket = require('socket.io');
var mysql = require('mysql');
var request = require('request');
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var env = require('dotenv').config();
var axios = require('axios');
var moment = require('moment'); 

//Connections Variables RMS
var rmshost = env.db_rms_ip;
var rmsuser = "sa";
var rmspassword = "1tdAutop1l0t";
var rmsdatabase = "rms";

//Connection Variables HMS
var hmshost = env.db_hms_ip;
var hmsuser = "sa";
var hmspassword = "1tdAutop1l0t";
var hmsdatabase = "hms";

//Connection Variables Reservation
var reservationhost = "external-db.s161964.gridserver.com";
var reservationuser = "db161964";
var reservationpassword = "king143vc";
var reservationdatabase = "db161964_vc_reserve";

//System User
var autopilotuser = "10907";

//Variables Status
var cleanstatusid = '1';
var inspecteddirtyid = '55';
var dirtystatusid = '3';
var occupiedstatusid = '2';
var forgeneralcleaningid = '21';
var reservedid = '12';
var inspectedcleanid = '28';
var dirtywithlinenid= '31';
var dirtywithwaitingguestid = '32';
var hotilifiedid = '27';
var inspecteddirty = '55';
var beloinspectionid = '60';
var forinspectionid = '7';
var preventivemaintenanceid = '14';
var soaid = '17';

//Variable Day
var days;

//Variables Balancer
var balancercount = 0;

//Notification Variables
var notifandroid = false;
var notifios = false;
var notifandroidios = false;

//Create Connection
var rmsconnection = mysql.createPool({
    host: rmshost,
    user: rmsuser,
    password: rmspassword,
    database: rmsdatabase,
});   
    
var hmsconnection = mysql.createPool({
    host: hmshost,
    user: hmsuser,
    password: hmspassword,
    database: hmsdatabase,
});

var reservationconnection = mysql.createPool({
    host: reservationhost,
    user: reservationuser,
    password: reservationpassword,
    database: reservationdatabase,
});


//Variables Local
var localid;
var local;
var isautopilot = false;
var notifandroid = false;
var notifios = false;

//App
var POSCHANGE_POLLING_INTERVAL = 3000;
var POLLING_INTERVAL = 10000;
var BALANCER_INTERVAL = 20000;
var port = '6969';
var pollingTimer;
var g_room;
var app = express();
var server = app.listen(port, function(){

    console.log('Listening to request on port ' + port);

});

//HTTP
var Http = new XMLHttpRequest();

//Socket
var io = socket(server);

io.on('connection', function(socket){

    console.log('made socket connection ' + socket.id);

    //JSON Response
    socket.on('reloadtags', function(data){ 
    	console.log(data);
        socket.volatile.emit('reloadtags', data);
    });

    socket.on('cancelledReload', function(data){
    	console.log(data);
    	socket.volatile.emit('cancelledReload', data);
    });

    socket.on('reloadbalancer', function(data){
    	console.log(data);
        socket.volatile.emit('balancer', data);
    });

});

SetLocalID();
function SetLocalID(){

    var query = rmsconnection.query("SELECT local_id, local_code FROM settings");

    query.on('error', function(err){
        console.log("Set Local ID Error");
        console.log(err);
    }).on('result', function(setting){

        console.log(setting);
        localid = setting.local_id;
        local = setting.local_code;

    }).on('end', function(){
        //Do Nothing
    });

}

POSChangeStatus(); //Update Status Base in HMS/POS Room Status
function POSChangeStatus(){

    var index = 0;
    var change = false;
    var obj = new Object();

    // 5.7 SQL
    var query = rmsconnection.query("SELECT b.id, b.room_no, b.room_status_id AS 'rms_room_status', b.from_room_status_id, CONVERT(b.updated_at, CHAR) AS 'p_date', a.CRoom_Stat AS 'hms_room_status' FROM hms.tblroom AS a INNER JOIN "+rmsdatabase+".tblroom AS b ON b.room_no=a.RoomNo WHERE b.room_status_id!=a.CRoom_Stat");

    // 5.5 SQL
    //var query = rmsconnection.query("SELECT b.id, b.room_no, b.room_status_id AS 'rms_room_status', b.from_room_status_id, CONVERT(b.updated_at, CHAR) AS 'p_date', a.CRoom_Stat AS 'hms_room_status' FROM hms.tblroom a INNER JOIN rms.tblroom b ON b.room_no=a.RoomNo WHERE b.room_status_id!=a.CRoom_Stat");

    query.on('error', function(err){
        console.log("POS Change Status Error");
        console.log(err);
    }).on('result', function(room){

        change = true;
        console.log(room);

        if(room.hms_room_status==6969){
            // rmsconnection.query("CALL POSChangeStatus('"+ room.id +"', '"+ room.rms_room_status +"', '31')");
            hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='31' WHERE RoomNo='"+ room.room_no +"'");
        }
        else{

            rmsconnection.query("CALL POSChangeStatus('"+ room.id +"', '"+ room.rms_room_status +"', '"+ room.hms_room_status +"')");

        }
        

        //Special Condition
        if(room.hms_room_status==17 || room.hms_room_status==31){
            if(isautopilot){
                isautopilot = false;
            }
            else{
                rmsconnection.query("CALL RMSLogs('"+ room.id +"', '"+ room.rms_room_status +"', '"+ room.p_date +"', '"+ room.hms_room_status +"')");
            }
        }

        if(room.hms_room_status=="31"){
            LongStayingGuest12Hours(room.id, room.room_no, room.rms_room_status, room.p_date);
            LongStayingGuest24Hours(room.id, room.room_no, room.rms_room_status, room.p_date);
        }
     

        obj[index] = {
            roomId: room.id,
            roomno: room.room_no,
            roomstatusid: room.hms_room_status,
            btnid: 'roomid' + room.id
        };

        index ++;

        //For POSNerdvana Change Status
        // if(room.hms_room_status!="31" && room.hms_room_status!="17" && room.hms_room_status!="2" && room.hms_room_status!="20"){
        //     console.log("POSNerdvanaChangeStatus Call");
        //     POSNerdvanaChangeStatus(room.room_no, room.hms_room_status);
        // }
        
        
    }).on('end', function(){

        if(change){
            
            setTimeout(function(){ 

                io.emit('reloadtags', obj);
                //For Mobile
                CallHTTP();

            }, 500);
            
            change = false;

        }

        setTimeout(POSChangeStatus, POSCHANGE_POLLING_INTERVAL);
       
    });
  
}

GCDays(); //General Cleaning in 4 Days of Clean
function GCDays(){

    var settings = rmsconnection.query("SELECT IF(automatic_general_cleaning_days!=0, automatic_general_cleaning_days, 'Disabled') AS 'automatic_general_cleaning_days', IF((SELECT CURRENT_TIME()) BETWEEN settings.window_time_general_cleaning_start AND settings.window_time_general_cleaning_end, 'Enabled', 'Disabled') AS 'window_gc' FROM settings");

    settings.on('error', function(err){
        console.log("General Cleaning In 4 Days Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automatic_general_cleaning_days=="Disabled"){
            setTimeout(GCDays, POLLING_INTERVAL);
        }
        else{

            if(setting.window_gc=="Disabled"){
                setTimeout(GCDays, POLLING_INTERVAL);
            }
            else{


                var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE TIMESTAMPDIFF(DAY, last_general_cleaning, NOW())>=(SELECT automatic_general_cleaning_days FROM settings) AND (tblroom.room_status_id='"+ inspecteddirtyid +"' OR tblroom.room_status_id='"+ dirtystatusid +"')");

                query.on('error', function(err){
                    console.log("General Cleaning In 4 Days Error");
                    console.log(err);
                }).on('result', function(room){
            
                    console.log("General Cleaning in 4 Days of Clean");
                    console.log(room);
            
                    //RMS Update
                    rmsconnection.query("UPDATE tblroom SET last_general_cleaning=NOW(), updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                    //HMS Update
                    hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+forgeneralcleaningid+"' WHERE RoomNo='"+ room.room_no +"'");
                    
                    //Logs
                    rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '"+ forgeneralcleaningid +"', '"+ autopilotuser +"')");
            
                    var obj = new Object();
                    obj.roomId = room.id;
                    obj.btnid = 'roomid' + room.id;
            
                    io.emit('reloadtags', obj);
            
                }).on('end', function(){
        
                    isautopilot = true;
                    setTimeout(GCDays, POLLING_INTERVAL);
            
                });

            }

        }

    }).on('end', function(){

    });  

}

GCCheckout(); //General Cleaning in 12 Checkout
function GCCheckout(){

    var settings = rmsconnection.query("SELECT IF(automatic_general_cleaning_checkout!=0, automatic_general_cleaning_checkout, 'Disabled') AS 'automatic_general_cleaning_checkout', IF((SELECT CURRENT_TIME()) BETWEEN settings.window_time_general_cleaning_start AND settings.window_time_general_cleaning_end, 'Enabled', 'Disabled') AS 'window_gc' FROM settings");

    settings.on('error', function(err){
        console.log("General Cleaning In 12 Checkout Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automatic_general_cleaning_checkout=="Disabled"){
            setTimeout(GCCheckout, POLLING_INTERVAL);
        }
        else{

            if(setting.window_gc=="Disabled"){
                setTimeout(GCCheckout, POLLING_INTERVAL);
            }
            else{

                var query = rmsconnection.query("SELECT id, room_no, checkout_count, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE checkout_count>=(SELECT automatic_general_cleaning_checkout FROM settings) AND (tblroom.room_status_id='"+ inspecteddirtyid +"' OR tblroom.room_status_id='"+ dirtystatusid +"')");

                query.on('error', function(err){
                    console.log("General Cleaning In 12 Checkout Error");
                    console.log(err);
                }).on('result', function(room){
            
                    console.log("General Cleaning in 12 Checkout");
                    console.log(room);
            
                    //RMS Update
                    rmsconnection.query("UPDATE tblroom SET checkout_count='0', updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                    //HMS Update
                    hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+forgeneralcleaningid+"' WHERE RoomNo='"+ room.room_no +"'");

                    //Logs
                    rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '"+ forgeneralcleaningid +"'. '"+ autopilotuser +"')");

                    var obj = new Object();
                    obj.roomId = room.id;
                    obj.btnid = 'roomid' + room.id;
            
                    io.emit('reloadtags', obj);
            
                }).on('end', function(){

                    isautopilot = true;                    
                    setTimeout(GCCheckout, POLLING_INTERVAL);
            
                });

            }

        }

    }).on('end', function(){

        
    });

    
}

CleanReCLean(); //Clean to Re-Clean After 24 Hours
function CleanReCLean(){

    var settings = rmsconnection.query("SELECT IF(automated_clean_reclean!=0, automated_clean_reclean, 'Disabled') AS 'automated_clean_reclean' FROM settings");

    settings.on('error', function(err){
        console.log("Clean To Re Clean Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automated_clean_reclean=="Disabled"){
            setTimeout(CleanReCLean, POLLING_INTERVAL);
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE room_status_id='"+ cleanstatusid +"' AND TIMESTAMPDIFF(HOUR, updated_at, NOW())>=(SELECT automated_clean_reclean FROM settings)");

            query.on('error', function(err){
                console.log("Clean To Re Clean Error");
                console.log(err);
            }).on('result', function(room){
        
                console.log("Clean to Re-Clean After 24 Hours");
                console.log(room);
        
                //RMS Update
                rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                //HMS Update
                hmsconnection.query("UPDATE tblroom SET Stat='CLEAN', CRoom_Stat='25' WHERE RoomNo='"+ room.room_no +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '25', '"+ autopilotuser +"')");
        
                var obj = new Object();
                obj.roomId = room.id;
                obj.btnid = 'roomid' + room.id;
        
                io.emit('reloadtags', obj);
        
            }).on('end', function(){

                isautopilot = true;
                setTimeout(CleanReCLean, POLLING_INTERVAL);
        
            });

        }

    }).on('end', function(){



    });


}

InspectedCleanReCLean(); //Inspected Clean to Re-Clean After 24 Hours
function InspectedCleanReCLean(){

    var settings = rmsconnection.query("SELECT IF(automated_clean_reclean!=0, automated_clean_reclean, 'Disabled') AS 'automated_clean_reclean' FROM settings");

    settings.on('error', function(err){
        console.log("Inspected Clean To Re Clean Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automated_clean_reclean=="Disabled"){
            setTimeout(InspectedCleanReCLean, POLLING_INTERVAL);
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE room_status_id='"+ inspectedcleanid +"' AND TIMESTAMPDIFF(HOUR, updated_at, NOW())>=(SELECT automated_clean_reclean FROM settings)");

            query.on('error', function(err){
                console.log("Clean To Re Clean Error");
                console.log(err);
            }).on('result', function(room){
        
                console.log("Clean to Re-Clean After 24 Hours");
                console.log(room);
        
                //RMS Update
                rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                //HMS Update
                hmsconnection.query("UPDATE tblroom SET Stat='CLEAN', CRoom_Stat='25' WHERE RoomNo='"+ room.room_no +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '25', '"+ autopilotuser +"')");
        
                var obj = new Object();
                obj.roomId = room.id;
                obj.btnid = 'roomid' + room.id;
        
                io.emit('reloadtags', obj);
        
            }).on('end', function(){

                isautopilot = true;
                setTimeout(InspectedCleanReCLean, POLLING_INTERVAL);
        
            });

        }

    }).on('end', function(){



    });


}

HotelifiedReCLean(); //Hotelified to Re-Clean After 24 Hours
function HotelifiedReCLean(){

    var settings = rmsconnection.query("SELECT IF(automated_clean_reclean!=0, automated_clean_reclean, 'Disabled') AS 'automated_clean_reclean' FROM settings");

    settings.on('error', function(err){
        console.log("Hotelified To Re Clean Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automated_clean_reclean=="Disabled"){
            setTimeout(HotelifiedReCLean, POLLING_INTERVAL);
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE room_status_id='"+ hotilifiedid +"' AND TIMESTAMPDIFF(HOUR, updated_at, NOW())>=(SELECT automated_clean_reclean FROM settings)");

            query.on('error', function(err){
                console.log("Clean To Re Clean Error");
                console.log(err);
            }).on('result', function(room){
        
                console.log("Clean to Re-Clean After 24 Hours");
                console.log(room);
        
                //RMS Update
                rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                //HMS Update
                hmsconnection.query("UPDATE tblroom SET Stat='CLEAN', CRoom_Stat='25' WHERE RoomNo='"+ room.room_no +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '25', '"+ autopilotuser +"')");
        
                var obj = new Object();
                obj.roomId = room.id;
                obj.btnid = 'roomid' + room.id;
        
                io.emit('reloadtags', obj);
        
            }).on('end', function(){

                isautopilot = true;
                setTimeout(HotelifiedReCLean, POLLING_INTERVAL);
        
            });

        }

    }).on('end', function(){



    });


}

DirtyReClean(); //Dirty to Re-Clean After 24 Hours
function DirtyReClean() {

    var settings = rmsconnection.query("SELECT IF(automated_dirty_reclean!=0, automated_dirty_reclean, 'Disabled') AS 'automated_dirty_reclean' FROM settings");

    settings.on('error', function(err){
        console.log("Dirty To Re Clean Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automated_dirty_reclean=="Disabled"){
            setTimeout(DirtyReClean, POLLING_INTERVAL);
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE (room_status_id='"+ dirtystatusid +"' OR room_status_id='"+ inspecteddirtyid +"') AND TIMESTAMPDIFF(HOUR, updated_at, NOW())>=(SELECT automated_dirty_reclean FROM settings)");

            query.on('error', function(err){
                console.log("Dirty To Re Clean Error");
                console.log(err);
            }).on('result', function(room){
        
                console.log("Dirty to Re-Clean After 24 Hours");
                console.log(room);
        
                //RMS Update
                rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                //HMS Update
                hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='26' WHERE RoomNo='"+ room.room_no +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '26', '"+ autopilotuser +"')");
        
                var obj = new Object();
                obj.roomId = room.id;
                obj.btnid = 'roomid' + room.id;
        
                io.emit('reloadtags', obj);
        
            }).on('end', function(){
        
                isautopilot = true;
                setTimeout(DirtyReClean, POLLING_INTERVAL);
        
            });
        
        }

    }).on('end', function(){



    });


}

InspectedDirtyReClean(); //Dirty to Re-Clean After 24 Hours
function InspectedDirtyReClean() {

    var settings = rmsconnection.query("SELECT IF(automated_dirty_reclean!=0, automated_dirty_reclean, 'Disabled') AS 'automated_dirty_reclean' FROM settings");

    settings.on('error', function(err){
        console.log("Dirty To Re Clean Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automated_dirty_reclean=="Disabled"){
            setTimeout(InspectedDirtyReClean, POLLING_INTERVAL);
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE (room_status_id='"+ inspecteddirty +"' OR room_status_id='"+ inspecteddirtyid +"') AND TIMESTAMPDIFF(HOUR, updated_at, NOW())>=(SELECT automated_dirty_reclean FROM settings)");

            query.on('error', function(err){
                console.log("Dirty To Re Clean Error");
                console.log(err);
            }).on('result', function(room){
        
                console.log("Dirty to Re-Clean After 24 Hours");
                console.log(room);
        
                //RMS Update
                rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room.id +"'");

                //HMS Update
                hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='26' WHERE RoomNo='"+ room.room_no +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '26', '"+ autopilotuser +"')");
        
                var obj = new Object();
                obj.roomId = room.id;
                obj.btnid = 'roomid' + room.id;
        
                io.emit('reloadtags', obj);
        
            }).on('end', function(){

                isautopilot = true;                
                setTimeout(InspectedDirtyReClean, POLLING_INTERVAL);
        
            });
        
        }

    }).on('end', function(){



    });


}

function LongStayingGuest12Hours(room_id, room_no, room_status, p_date){ //Check Room For 12 Hours
    
    var counter = 0;
    var limit = rmsconnection.query("SELECT IF(staying_guest_12!=0, staying_guest_12, 'Disabled') AS 'staying_guest_12' FROM settings");

    console.log("Check Room For 12 Hours");
    limit.on('error', function(err){
        console.log("Longstaying Guest 12 Hours Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.staying_guest_12=="Disabled"){
            //Do Nothing
        }
        else{

            var query = hmsconnection.query("SELECT tblroomrate.MaxHr FROM tblcustomerinfo INNER JOIN tblroomrate ON tblroomrate.RateDesc=tblcustomerinfo.RateDesc AND tblroomrate.RoomType=tblcustomerinfo.RoomType WHERE tblcustomerinfo.RoomNo='"+ room_no +"' AND tblcustomerinfo.Stat='C/OUT' ORDER BY tblcustomerinfo.id DESC LIMIT "+ setting.staying_guest_12 +"");
        
            query.on('err', function(err){
                console.log("Longstaying Guest 12 Hours Error");
                console.log(err);
            }).on('result', function(room){

                if(room.MaxHr==12){
                    counter += 1;
                }

                if(counter==2){
                
                    //RMS Update
                    rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room_id +"'");

                    //HMS
                    hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+forgeneralcleaningid+"' WHERE RoomNo='"+ room_no +"'");

                    //Logs
                    rmsconnection.query("CALL AutopilotLogs('"+ room_id +"', '"+ room_status +"', '"+ p_date +"', '"+forgeneralcleaningid+"', '"+ autopilotuser +"')");

                    var obj = new Object();
                    obj.roomId = room_id;
                    obj.btnid = 'roomid' + room_id;

                    io.emit('reloadtags', obj);

                }
        
            }).on('end', function(){
                isautopilot = true;
            });

        }

    }).on('end', function(){


    });
    

}

function LongStayingGuest24Hours(room_id , room_no, room_status, p_date){ //Check Room For 24 Hours
    
    var counter = 0;
    var limit = rmsconnection.query("SELECT IF(staying_guest_24!=0, staying_guest_24, 'Disabled') AS 'staying_guest_24' FROM settings");

    console.log("Check Room For 24 Hours");
    limit.on('error', function(err){
        console.log("Longstaying Guest 24 Hours Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.staying_guest_24=="Disabled"){
            //Do Nothing
        }
        else{

            var query = hmsconnection.query("SELECT tblroomrate.MaxHr FROM tblcustomerinfo INNER JOIN tblroomrate ON tblroomrate.RateDesc=tblcustomerinfo.RateDesc AND tblroomrate.RoomType=tblcustomerinfo.RoomType WHERE tblcustomerinfo.RoomNo='"+ room_no +"' AND tblcustomerinfo.Stat='C/OUT' ORDER BY tblcustomerinfo.id DESC LIMIT "+ setting.staying_guest_24 +"");
        
            query.on('err', function(err){
                console.log("Longstaying Guest 24 Hours Error");
                console.log(err);
            }).on('result', function(room){

                if(room.MaxHr==24){
                    counter += 1;
                }

                if(counter==2){
                
                    //RMS Update
                    rmsconnection.query("UPDATE tblroom SET updated_at=NOW(), from_userinfo='"+ autopilotuser +"' WHERE id='"+ room_id +"'");

                    //HMS Update
                    hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+forgeneralcleaningid+"' WHERE RoomNo='"+ room_no +"'");

                    //Logs
                    rmsconnection.query("CALL AutopilotLogs('"+ room_id +"', '"+ room_status +"', '"+ p_date +"', '"+forgeneralcleaningid+"', '"+ autopilotuser +"')");

                    var obj = new Object();
                    obj.roomId = room_id;
                    obj.btnid = 'roomid' + room_id;

                    io.emit('reloadtags', obj);

                }
        
            }).on('end', function(){
                isautopilot = true;
            });

        }

    }).on('end', function(){

    });

}

// ReservedRooms();
function ReservedRooms(){

     var query = reservationconnection.query("SELECT Room_number FROM room_reservation_details WHERE Locale_ID='"+ localid +"' AND Reserve_Date=DATE_FORMAT(NOW(), '%Y-%m-%d') AND TIMESTAMPDIFF(HOUR, CURRENT_TIME(), `Time`)<=3 AND TIMESTAMPDIFF(HOUR, CURRENT_TIME(), `Time`)>0");

     query.on('error', function(err){
        console.log("Reserve Room Error 1");
        console.log(err);
     }).on('result', function(room){

        console.log(room);

        var status = rmsconnection.query("SELECT IF(room_status_id='"+ cleanstatusid +"' OR room_status_id='"+ inspectedcleanid +"', 'TRUE', 'FALSE') AS 'room_status' FROM tblroom WHERE room_no='"+ room.Room_number +"' AND (room_status_id='"+ cleanstatusid +"' OR room_status_id='"+ inspectedcleanid +"')");

        status.on('error', function(err){
            console.log("Reserve Room Error 2");
            console.log(err);
        }).on('result', function(stat){

            if(stat.room_status=="TRUE"){
                hmsconnection.query("UPDATE tblroom SET CRoom_Stat='"+ reservedid +"' WHERE RoomNo='"+ room.Room_number +"'");
            }
            
        }).on('end', function(){


        });

     }).on('end', function(){

        setTimeout(ReservedRooms, POLLING_INTERVAL);

     });

}

//Room Mileage
RoomMileage();
function RoomMileage(){
    
    var settings = rmsconnection.query("SELECT IF(automatic_belo_checkout!=0, automatic_belo_checkout, 'Disabled') AS 'automatic_belo_checkout' FROM settings");

    settings.on('error', function(err){
        console.log("Automatic Belo Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automatic_belo_checkout=="Disabled"){
            setTimeout(RoomMileage, POLLING_INTERVAL);            
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE room_status_id='"+ dirtystatusid +"' AND belo_count>=(SELECT automatic_belo_checkout FROM settings)");

            query.on('error', function(err){
                console.log("Get Automatic Belo Error");
                console.log(err);
            }).on('result', function(room){

                //For Belo Inspection
                hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+ beloinspectionid +"' WHERE RoomNo='"+ room.room_no +"'");
                // rmsconnection.query("UPDATE tblroom SET belo_count=0 WHERE id='"+ room.id +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '"+ beloinspectionid +"', '"+ autopilotuser +"')");

            }).on('end', function(){
                isautopilot = true;
                setTimeout(RoomMileage, POLLING_INTERVAL);                
            });

        }

    }).on('end', function(){


    });

}

//Pest Control
RecoveryForInspection();
function RecoveryForInspection(){

    console.log('Recovery');
    var settings = rmsconnection.query("SELECT IF(recovery_time!=0, recovery_time, 'Disabled') AS 'recovery_time' FROM settings");

    settings.on('error', function(err){
        console.log("Automatic Pest Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.recovery_time=="Disabled"){
            setTimeout(RecoveryForInspection, 2000);          
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE is_pest=1 AND (SELECT recovery_time FROM settings)<=HOUR(TIMEDIFF(updated_at, NOW()))");

            query.on('error', function(err){
                console.log("Get Automatic Pest Error");
                console.log(err);
            }).on('result', function(room){

                console.log(room);

                //For Inspection
                hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+ forinspectionid +"' WHERE RoomNo='"+ room.room_no +"'");
                rmsconnection.query("UPDATE tblroom SET is_pest=0 WHERE id='"+ room.id +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '"+ forinspectionid +"', '"+ autopilotuser +"')");

            }).on('end', function(){
                isautopilot = true;
                setTimeout(RecoveryForInspection, 2000);
            });

        }

    }).on('end', function(){


    });

}

//Preventive Maintenance (Aircon)
PreventiveMaintenanceAircon();
function PreventiveMaintenanceAircon(){

    var settings = rmsconnection.query("SELECT IF(automatic_preventive_maintance_checkout!=0, automatic_preventive_maintance_checkout, 'Disabled') AS 'automatic_preventive_maintance_checkout' FROM settings");

    settings.on('error', function(err){
        console.log("Automatic Preventive Maintenance Aircon Error");
        console.log(err);
    }).on('result', function(setting){

        if(setting.automatic_preventive_maintance_checkout=="Disabled"){
            setTimeout(PreventiveMaintenanceAircon, POLLING_INTERVAL);          
        }
        else{

            var query = rmsconnection.query("SELECT id, room_no, room_status_id, CONVERT(updated_at, CHAR) AS 'p_date' FROM tblroom WHERE preventive_checkout_count>='"+ setting.automatic_preventive_maintance_checkout +"' AND room_status_id='"+ dirtystatusid +"'");

            query.on('error', function(err){
                console.log("Get Preventive Maintenance Aircon Error");
                console.log(err);
            }).on('result', function(room){

                //For Inspection
                hmsconnection.query("UPDATE tblroom SET Stat='DIRTY', CRoom_Stat='"+ preventivemaintenanceid +"' WHERE RoomNo='"+ room.room_no +"'");
                // rmsconnection.query("UPDATE tblroom SET preventive_checkout_count=0 WHERE id='"+ room.id +"'");

                //Logs
                rmsconnection.query("CALL AutopilotLogs('"+ room.id +"', '"+ room.room_status_id +"', '"+ room.p_date +"', '"+ preventivemaintenanceid +"', '"+ autopilotuser +"')");

            }).on('end', function(){
                isautopilot = true;
                setTimeout(PreventiveMaintenanceAircon, POLLING_INTERVAL);
            });

        }

    }).on('end', function(){


    });

}

// Refresh Badge Belo
RefreshBadgeBelo();
function RefreshBadgeBelo(){

    var belo_count = 0;
    var query = rmsconnection.query("SELECT COUNT(*) AS 'belo_count' FROM tblroom WHERE belo_count>=(SELECT (automatic_belo_checkout * automatic_belo_percentage) FROM settings)");

    query.on('error', function(err){
        console.log("Refresh Badge Belo Error");
        console.log(err);
    }).on('result', function(belo){

        belo_count = belo.belo_count

    }).on('end', function(){

        io.emit('belobadge', {belo_count: belo_count});
        setTimeout(RefreshBadgeBelo, POLLING_INTERVAL);

    });

}

// Room Balancer Notif
// RoomBalancerNotif();
// function RoomBalancerNotif(){

//     //Validation
//     var query = rmsconnection.query("SELECT COUNT(*) AS 'counttype', GROUP_CONCAT(balancer.room_type_id) AS 'room_type_id', SUM(balancer.percentage) AS 'percentage' FROM (SELECT tbl_grp_room_type.group_name, GROUP_CONCAT(tbl_grp_room_type.room_type_id) AS 'room_type_id', tbl_room_balancer.percentage FROM tbl_room_balancer INNER JOIN tbl_grp_room_type ON tbl_grp_room_type.id=tbl_room_balancer.grproomid GROUP BY tbl_grp_room_type.group_name) balancer");

//     query.on('error', function(err){
//         console.log("Room Balance Notif Error");
//         console.log(err);
//     }).on('result', function(group){

//         var value = rmsconnection.query("SELECT CEILING((COUNT(*) * "+ group.percentage +") / "+ group.counttype +") AS 'roomcount' FROM tblroom WHERE tblroom.room_type_id IN ("+ group.room_type_id +") AND tblroom.room_status_id IN (3,16,18,21,26,31,53,55,56)");

//         value.on('error', function(err){
//             console.log("Data Error");
//             console.log(err);
//         }).on('result', function(val){

//             if(val.roomcount!=0){

//                 io.volatile.emit('reloadbalancernotif', {balancercount: val.roomcount, isblink: true});

//             }
//             else{

//                 io.volatile.emit('reloadbalancernotif', {balancercount: val.roomcount, isblink: false});

//             }

//         }).on('end', function(){



//         });

//     }).on('end', function(){

//         setTimeout(RoomBalancerNotif, BALANCER_INTERVAL);

//     });

// }

//Room Balancer
RoomBalancer();
function RoomBalancer(){

    //Variables
    var balancer = [];
    balancercount = 0;

    //Validation
    var query = rmsconnection.query("SELECT REPLACE(tblroomtype.room_type, ' ', '') AS 'group_name', tbl_room_balancer.grproomid AS 'room_type_id', tbl_room_balancer.percentage FROM tbl_room_balancer INNER JOIN tblroomtype ON tblroomtype.id=tbl_room_balancer.grproomid");

    query.on('error', function(err){
        console.log("Room Balance Errsor");
        console.log(err);
    }).on('result', function(group){

        var value = rmsconnection.query("SELECT COUNT(*) AS 'count', CEILING((COUNT(*) * "+ group.percentage +")) AS 'roomcount', (SELECT COUNT(*) FROM tblroom WHERE room_type_id="+ group.room_type_id +" AND (room_status_id="+ cleanstatusid +" OR room_status_id="+ inspectedcleanid +" OR room_status_id="+ hotilifiedid +")) AS 'cleancount', CONCAT(FORMAT((((SELECT COUNT(*) FROM tblroom WHERE room_type_id="+ group.room_type_id +" AND (room_status_id="+ cleanstatusid +" OR room_status_id="+ inspectedcleanid +" OR room_status_id="+ hotilifiedid +")) / COUNT(*)) * 100), 2), '%') AS 'cleanpercentage' FROM tblroom WHERE tblroom.room_type_id="+ group.room_type_id +"");

        value.on('error', function(err){
            console.log("Value Balance Error");
            console.log(err);
        }).on('result', function(val){

            console.log(val);

            var rooms = [];

            if(val.roomcount>val.cleancount){

                var data = rmsconnection.query("SELECT room_no, updated_at FROM tblroom WHERE room_type_id="+ group.room_type_id +" AND room_status_id IN (3,16,18,21,26,31,53,55,56,25) ORDER BY TIMEDIFF(NOW(), updated_at) DESC LIMIT "+ val.roomcount +"");

                data.on('error', function(err){
                    console.log("Data Error");
                    console.log(err);
                }).on('result', function(info){

                    balancercount += 1;

                    rooms.push({
                        room_no: info.room_no
                    });
            
                }).on('end', function(){

                    balancer = {
                        roomtype: group.group_name,
                        rooms: rooms,
                        cleanpercent: val.cleanpercentage
                    };

                    io.volatile.emit('reloadbalancer', {balancer: balancer});
                    console.log(balancer);

                });

            }
            else{

                console.log("COUNT ROOM: " + rooms.length);
                if(rooms.length==0){

                    rooms.push({
                        room_no: 'No Data'
                    });

                    balancer = {
                        roomtype: group.group_name,
                        rooms: rooms,
                        cleanpercent: val.cleanpercentage
                    };

                    //Emit
                    io.volatile.emit('reloadbalancer', {balancer: balancer});
                    console.log(balancer);

                }

            }

        }).on('end', function(){


        });

    }).on('end', function(){

        setTimeout(function(){

            // Room Balancer Notif
            if(balancercount!=0){

                io.volatile.emit('reloadbalancernotif', {balancercount: balancercount, isblink: true});

            }
            else{

                io.volatile.emit('reloadbalancernotif', {balancercount: balancercount, isblink: false});

            }

        }, 1500);

        setTimeout(RoomBalancer, BALANCER_INTERVAL);

    });


}

//Dione
function CallHTTP(){

    var ax = Http;
    
    var url = 'http://'+env.db_rms_ip+':6970/emitOnlineUsers?locale_id='+localid;
    ax.open("GET", url);
    ax.send();

}

//Notification
AutopilotNotification();
function AutopilotNotification(){

    var dayquery = rmsconnection.query("SELECT LCASE(DATE_FORMAT(NOW(), '%a')) AS 'day'");

    console.log("Autopilot Notif");
    dayquery.on('error', function(err){
        console.log("Autopilot Notif Error");
        console.log(err);
    }).on('result', function(data){

        console.log(data);
        days = data.day;

        var schedulequery = rmsconnection.query("SELECT id, operation, description, TIME_FORMAT(schedule_time, '%H:%i') AS 'schedule_time' FROM notification_schedule WHERE enabled='1' AND "+ days +"='1'");

        schedulequery.on('error', function(err){
            console.log(err);
        }).on('result', function(sched){

           console.log(sched);

           // From date to moment 
           var wrapped = moment(new Date()).format("HH:mm");; 
           console.log(wrapped); 

           if(wrapped==sched.schedule_time){

                if(sched.operation=="Occupied"){

                    console.log("Occupied");

                    var ax1 = axios;
                    var ax2 = axios;
    
                    if(!notifandroid){
    
                        notifandroid = true;
    
                        ax1.post('http://'+env.db_rms_ip+'/rms/api/device/notifautopilotandroid', { schedid: sched.id, local: local, devicetype: 'Android' })
                        .then(function(response){

                            //Success Logs
                            console.log(response);
                            console.log('Send successfully Android');

                            setTimeout(function(){
                                notifandroid = false;
                            }, 60000);

                        }).catch(function(error){

                            //Error Logs
                            console.log(error);

                            setTimeout(function(){
                                notifandroid = false;
                            }, 60000);

                        });
    
                    }
                    
                    if(!notifios){
    
                        notifios = true;
    
                        ax2.post('http://'+env.db_rms_ip+'/rms/api/device/notifautopilotios', { schedid: sched.id, local: local, devicetype: 'ios' })
                        .then(function(response){

                            //Success Logs
                            console.log(response);
                            console.log('Send successfully IOS');

                            setTimeout(function(){
                                notifios = false;
                            }, 60000);

                        }).catch(function(error){

                            //Error Logs
                            console.log(error);
                            
                            setTimeout(function(){
                                notifios = false;
                            }, 60000);

                        }); 
    
                    }

                }
                else if(sched.operation=="Shift"){

                    console.log("Shift");

                    var ax1 = axios;
                    var ax2 = axios;
                    var description = sched.description;

                    if(!notifandroidios){

                        notifandroidios = true;

                        ax1.post('http://'+env.db_rms_ip+'/rms/api/device/notifautopilotshiftandroidios', { 
                            schedid: sched.id, 
                            local: local,
                            description: description, 
                            devicetype: 'Android' 
                        }).then(function(response){

                            //Success Logs
                            console.log(response);
                            console.log('Send successfully Android');

                            setTimeout(function(){
                                notifandroidios = false;
                            }, 60000);

                        }).catch(function(error){

                            //Error Logs
                            console.log(error);
                            
                            setTimeout(function(){
                                notifandroidios = false;
                            }, 60000);

                        });

                    }

                }

           }


        }).on('end', function(){

            setTimeout(AutopilotNotification, 30000);

        });

    }).on('end', function(){
       
    });

}

function POSNerdvanaChangeStatus(room_no, room_status_id){

    var ax = axios;

    // Send a POST request
    ax({
        method: 'post',
        url: 'http://192.168.1.23/pos/api/vc/ma/changeRoomStatus',
        data: {
            room_no: room_no,
            room_status_id: room_status_id,
            user_id: '1',
            emp_id: '1',
            remarks: ''
        },
        responseType: 'json'
    }).then(function(response){
        console.log(response);
        console.log('Send successfully');
    });

}

//Old Notification
//Notification
// OccupiedRate();
// function OccupiedRate(){
  
//     var dayquery = rmsconnection.query("SELECT LCASE(DATE_FORMAT(NOW(), '%a')) AS 'day'");

//     console.log("Occupied Rate Notif");
//     dayquery.on('error', function(err){
//         console.log("Occupied Rate Error");
//         console.log(err);
//     }).on('result', function(data){

//         console.log(data);
//         days = data.day;

//         var schedulequery = rmsconnection.query("SELECT id, TIME_FORMAT(schedule_time, '%H:%i') AS 'schedule_time' FROM notification_schedule WHERE enabled='1' AND "+ days +"='1' AND operation='Occupied'");

//         schedulequery.on('error', function(err){
//             console.log(err);
//         }).on('result', function(sched){

//            console.log(sched);

//            // From date to moment 
//            var wrapped = moment(new Date()).format("HH:mm");; 
//            console.log(wrapped); 

//            if(wrapped==sched.schedule_time){

//                 axios.post('http://'+env.db_rms_ip+'/rms/api/device/notifoccupiedrate', { schedid: sched.id, local: local })
//                 .then(function(response){
//                     console.log(response);
//                     console.log('Send successfully');
//                 }); 

//            }


//         }).on('end', function(){

//             setTimeout(OccupiedRate, 30000);

//         });

//     }).on('end', function(){
       
//     });
    

// }

// STLRooms();
// function STLRooms(){

//     var dayquery = rmsconnection.query("SELECT LCASE(DATE_FORMAT(NOW(), '%a')) AS 'day'");

//     console.log("STL Room Notif");
//     dayquery.on('error', function(err){
//         console.log("STL Room Error");
//         console.log(err);
//     }).on('result', function(data){

//         console.log(data);
//         days = data.day;

//         var schedulequery = rmsconnection.query("SELECT id, TIME_FORMAT(schedule_time, '%H:%i') AS 'schedule_time' FROM notification_schedule WHERE enabled='1' AND "+ days +"='1' AND operation='STL'");

//         schedulequery.on('error', function(err){
//             console.log(err);
//         }).on('result', function(sched){

//            console.log(sched);

//            // From date to moment 
//            var wrapped = moment(new Date()).format("HH:mm"); 
//            console.log(wrapped); 

//            if(wrapped==sched.schedule_time){

//                 axios.post('http://'+env.db_rms_ip+'/rms/api/device/notifstlrooms', { schedid: sched.id, local: local })
//                 .then(function(response){
//                     console.log(response);
//                     console.log('Send successfully');
//                 }); 

//            }


//         }).on('end', function(){

//             setTimeout(STLRooms, 35000);

//         });

//     }).on('end', function(){
       
//     });

// }


// DirtyRooms();
// function DirtyRooms(){

//     var dayquery = rmsconnection.query("SELECT LCASE(DATE_FORMAT(NOW(), '%a')) AS 'day'");

//     console.log("Dirty Room Notif");
//     dayquery.on('error', function(err){
//         console.log("Dirty Room Error");
//         console.log(err);
//     }).on('result', function(data){

//         console.log(data);
//         days = data.day;

//         var schedulequery = rmsconnection.query("SELECT id, TIME_FORMAT(schedule_time, '%H:%i') AS 'schedule_time' FROM notification_schedule WHERE enabled='1' AND "+ days +"='1' AND operation='Dirty'");

//         schedulequery.on('error', function(err){
//             console.log(err);
//         }).on('result', function(sched){

//            console.log(sched);

//            // From date to moment 
//            var wrapped = moment(new Date()).format("HH:mm"); 
//            console.log(wrapped); 

//            if(wrapped==sched.schedule_time){

//                 axios.post('http://'+env.db_rms_ip+'/rms/api/device/notifdirtyrooms', { schedid: sched.id, local: local })
//                 .then(function(response){
//                     console.log(response);
//                     console.log('Send successfully');
//                 }); 

//            }


//         }).on('end', function(){

//             setTimeout(DirtyRooms, 40000);

//         });

//     }).on('end', function(){
       
//     });

// }