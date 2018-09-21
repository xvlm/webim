<?php

namespace console\controllers;

//use common\models\Task;
use Yii;
use yii\console\Controller;

define('HASH_USERINFO', 'chat_userinfo_hash'); //注册用户列表
//define( SET_ONLINELIST,'chat_onlinelist_set' ); //在线用户列表库
define('HASH_FD2USERINFO', 'chat_fd2userinfo_hash'); //FD映射用户信息
define('HASH_USERNAME2FD', 'chat_username2fd_hash'); //映射用户名FD
define('HASH_READLIST', 'chat_readlist_hash'); //已读聊天列表
define('HASH_UNREADLIST', 'chat_unreadlist_hash'); //未读聊天列表

/**
 * TaskController implements the CRUD actions for Task model.
 */
class ChatController extends Controller
{

    const STATUS_SUCCESS = 1; //成功状态
    const STATUS_FAIL = 2; //失败状态

    private $_ws = null;
    private $_msg = [];
    private $_para = [];
    private $_fdMap = []; //fd的字典
    private $_userMap = []; //user对应的fd字典

    private function _log($action, $msg)
    {
        $datetime = date('Y-m-d');
        $log = "[{$datetime}] {$action} {$msg} \n";
        echo $log;
    }

    public function actionServer()
    {
        $ip = "0.0.0.0";
        $port = 9601;
        echo "time:" . date('Y-m-d H:i:s', time());
        echo " IM Server Start";
        echo "\n";
        echo "IP:{$ip} PORT:{$port}";
        echo "\n";
        $this->_ws = new \swoole_websocket_server("0.0.0.0", 9601);
        //监听WebSocket连接打开事件
        $this->_ws->on('open', function ($ws, $request) {
            $fd = $request->fd;
            echo "Client Connected:{$fd}\n";
        });

        //监听WebSocket消息事件
        $this->_ws->on('message', function ($server, $frame) {
            $time = time();
            $fd = $frame->fd;
            echo "time:" . date('Y-m-d H:i:s', time()) . " message:{$fd}";
            $server->push($fd, $frame->data);
            $request = json_decode($frame->data, true);
            $data = [];
            foreach ($request as $key => $value) {
                $data[$value['name']] = $value['value'];
            }
            switch ($data['module']) {
                case 'login':
                    echo " module:login\n";
                    $this->login($server, $frame, $data);
                    break;
                case 'register':
                    echo " module:register\n";
                    $this->register($server, $frame, $data);
                    break;
                case 'forgetpwd':
                    echo " module:forgetpwd\n";
                    $this->forgetpwd($server, $frame, $data);
                    break;
                case 'app':
                    echo " module:app\n";
                    $this->app($server, $frame, $data);
                    break;
                case 'chat':
                    echo " module:chat\n";
                    $this->chat($server, $frame, $data);
                    break;
                default:
                    break;
            }

//             $redis = Yii::$app->redis;
            //             $fd2UserInfo = $redis->get("chat_fd2UserInfoMap_{$fd}");
            //             $userInfo = $fd2UserInfo ? json_decode($fd2UserInfo, true) : null;
            //             $fromUserId = $userInfo['fromUserData']['user_id'];
            //             $toUserId = $userInfo['toUserId'];
            //             $toUserFd = $redis->get("chat_userId2FdMap_{$toUserId}");
            //             $this->_log('message', "  FROM: user_id: {$fromUserId},  user_loginname: {$userInfo['fromUserData']['user_loginname']}");

//             if ($toUserFd) {
            //                 $toUserInfo = $redis->get("chat_fd2UserInfoMap_{$toUserFd}");
            //                 $toUserInfo = $toUserInfo ? json_decode($toUserInfo, true) : null;
            //                 if ($toUserInfo && !empty($toUserInfo["fromUserData"]["user_id"]) && (string) $toUserInfo["fromUserData"]["user_id"] === (string) $toUserId) {

//                 } else {
            //                     echo "userId2FdMap 与 fd2UserInfoMap 不匹配\n";
            //                     $toUserFd = null;
            //                 }
            //             }

// //            var_dump($userInfo, $toUserFd);
            // //设置聊天记录KEY
            //             $array = array($fromUserId, $toUserId);
            //             $noReadChatKey = 'no_read_chat_record_' . implode('_', $array);
            //             asort($array);
            //             $readChatRecord = 'read_chat_record_' . implode('_', $array);

// //设置聊天内容
            //             $chatValue['date'] = date('Y-m-d H:i', $time);
            //             $chatValue['time'] = $time;
            //             $chatValue['userid'] = $fromUserId;
            //             $chatValue['username'] = $userInfo['fromUserData']['user_loginname'];
            //             $chatValue['content'] = $frame->data;

//             $redis->zadd($readChatRecord, $time, json_encode($chatValue));
            //             $sendData = "{$chatValue['date']}||{$chatValue['userid']}||{$userInfo['fromUserData']['user_loginname']}||{$frame->data}";

// //广播
            //             $server->push($fd, $sendData);
            // //            $toUserFd = isset($this->_userMap[$fdMap['toUserId']]) ? $this->_userMap[$fdMap['toUserId']] : '';
            //             if (!empty($toUserFd)) {
            //                 $fdExist = $server->exist($toUserFd);

//                 $pushResult = $server->push($toUserFd, $sendData);
            //                 echo "toUserId: {$toUserId} \n toUserFd:{$toUserFd} \n fdExist:{$fdExist}\n", $pushResult, "\n";
            //             } else {
            //                 $sendData = "{$chatValue['date']}||0||{$userInfo['fromUserData']['user_loginname']}||对方不在线，我们将尽快通知对方";
            //                 $server->push($fd, $sendData);
            //                 $redis->zadd($noReadChatKey, $time, json_encode($chatValue));
            //             }
        });

        //监听WebSocket连接关闭事件
        $this->_ws->on('close', function ($ws, $fd) {
            $redis = Yii::$app->redis;
            $this->getUserInfo($fd);
            if ($userinfo) {
                $redis->hdel(HASH_FD2USERINFO, $fd);
                $redis->hdel(HASH_USERNAME2FD, $userinfo['username']);
                $this->onlinelist($ws);
            }
            // $fd2UserInfo = $redis->get("chat_fd2UserInfoMap_{$fd}");
            // $userInfo = $fd2UserInfo ? json_decode($fd2UserInfo, true) : null;
            // $fromUserId = $userInfo['fromUserData']['user_id'];
            // $redis->del("chat_fd2UserInfoMap_{$fd}");
            // $redis->del("chat_userId2FdMap_{$fromUserId}", $fd);
            echo "client-{$fd} is closed\n";
        });
        $this->_ws->start();
    }

    public function getUserinfo($fd)
    {
        $redis = Yii::$app->redis;
        $userinfo = $redis->hget(HASH_FD2USERINFO, $fd);
        if ($userinfo) {
            return json_decode($userinfo, true);
        }
    }

    /**
     * 处理登录请求模块
     * 参数：
     * $server socket对象
     * $frame TCP客户端连接的标识符，在Server程序中是唯一的
     * $data 用户提交数据
     */
    public function login($server, $frame, $data)
    {
        $msg = ['module' => 'login', 'err' => 0, 'msg' => 'test'];
        $fd = $frame->fd;
        $redis = Yii::$app->redis;
        $exists = $redis->hexists(HASH_USERINFO, $data['username']);
        if (!$exists) {
            $msg['err'] = -1;
            $msg['msg'] = '账号不存在';
            $this->send($server, $fd, $msg);
        } else {
            $userinfo = json_decode($redis->hget(HASH_USERINFO, $data['username']), true);
            if ($data['password'] === $userinfo['password']) {
                $msg['msg'] = '登陆成功';
                //登记为在线用户
                $redis->hset(HASH_FD2USERINFO, $fd, json_encode($data));
                $redis->hset(HASH_USERNAME2FD, $data['username'], $fd);
            } else {
                $msg['err'] = -1;
                $msg['msg'] = '账号密码错误';
            }
            $this->send($server, $fd, $msg);
        }
    }

    //实时聊天模块
    public function app($server, $frame, $data)
    {
        $msg = ['module' => 'app', 'act' => 'userinfo', 'err' => 0, 'data' => []];
        $msg['data'] = $this->getUserinfo($frame->fd);
        $this->send($server, $frame->fd, $msg);
        $this->onlinelist($server, $frame, $data);
    }

    /**
    * 点对点通讯模块
    * $server socket对象
    * $frame TCP客户端连接的标识符，在Server程序中是唯一的
    * $data 用户提交数据
    */
    public function chat($server, $frame, $data)
    {
        $msg = ['module' => 'app', 'act' => 'chat', 'err' => 0, 'data' => []];
        $redis = Yii::$app->redis;
        $fd = $frame->fd;
        $userinfo = $this->getUserinfo($fd);
        $toFd = $redis->hget(HASH_USERNAME2FD, $data['toUsername']);
        echo "TOFD:{$toFd}\n";
        //若对方用户在线发送到到该用户的fd下，不在线提示“用户不在线”
        if ($toFd) {
            $msg = [
                'module' => 'app',
                'act' => 'chat',
                'err' => 0,
                'msg' => [
                    ['toUsername' => $userinfo['username'], 'time' => date('Y-m-d H:i:s', time()), 'self' => '', 'msg' => $data['msg']],
                ],
            ];
            $this->send($server, $toFd, $msg);
        } else {
            $msg = ['module' => 'app', 'act' => 'chat', 'err' => -1, 'msg' => '用户不在线'];
            $this->send($server, $fd, $msg);
        }

    }

    public function onlinelist($server)
    {
        $msg = ['module' => 'app', 'act' => 'onlinelist', 'err' => 0, 'data' => []];
        $redis = Yii::$app->redis;
        //获取在线用户列表
        $msg['data'] = $redis->hkeys(HASH_USERNAME2FD);
        $fd = $redis->hkeys(HASH_FD2USERINFO);
        foreach ($fd as $key => $value) {
            $this->send($server, $value, $msg);
        }
    }

    /**
     * 处理注册请求模块
     * 参数：
     * $server socket对象
     * $frame TCP客户端连接的标识符，在Server程序中是唯一的
     * $data 用户提交数据
     */
    public function register($server, $frame, $data)
    {
        $msg = ['module' => 'register', 'err' => 0, 'msg' => 'test'];
        $fd = $frame->fd;
        $checkmail = "/\w+([-+.']\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*/"; //定义正则表达式
        if (isset($data['email']) && $data['email'] != "") { //判断文本框中是否有值
            $mail = $data['email']; //将传过来的值赋给变量$mail
            if (!preg_match($checkmail, $mail)) { //用正则表达式函数进行判断
                $msg['err'] = -1;
                $msg['msg'] = '邮箱格式不正确';
                $this->send($server, $fd, $msg);
                return;
            }
        }
        else{
            $msg['err'] = -1;
            $msg['msg'] = '未填写邮箱信息';
            $this->send($server, $fd, $msg);
            return;
        }

        $redis = Yii::$app->redis;
        //检查账号是否已存在，如果存在发送错误提示，如果不存在将数据写入数据库中保存，并提示成功信息
        $exists = $redis->hexists(HASH_USERINFO, $data['username']);
        if ($exists) {
            $msg['err'] = -1;
            $msg['msg'] = '账号已存在';
            $this->send($server, $fd, $msg);
        } else {
            $ret = $redis->hset(HASH_USERINFO, $data['username'], json_encode($data));
            $msg['err'] = $ret ? 0 : $ret;
            $msg['msg'] = $ret ? '注册成功' : '注册失败';
            $this->send($server, $fd, $msg);
        }
    }
    public function forgetpwd($server, $frame, $data)
    {

    }

    public function send($server, $fd, $msg)
    {
        if ($server->exist($fd)) {
            $server->push($fd, json_encode($msg));
        }
    }
}

class WS
{

    public $master; // 连接 server 的 client
    public $sockets = array(); // 不同状态的 socket 管理
    public $handshake = false; // 判断是否握手

    public function __construct($address, $port)
    {
// 建立一个 socket 套接字
        $this->master = socket_create(AF_INET, SOCK_STREAM, SOL_TCP)
        or die("socket_create() failed");
        socket_set_option($this->master, SOL_SOCKET, SO_REUSEADDR, 1)
        or die("socket_option() failed");
        socket_bind($this->master, $address, $port)
        or die("socket_bind() failed");
        socket_listen($this->master, 2)
        or die("socket_listen() failed");

        $this->sockets[] = $this->master;

// debug
        echo ("Master socket  : " . $this->master . "\n");

        while (true) {
//自动选择来消息的 socket 如果是握手 自动选择主机
            $write = null;
            $except = null;
            socket_select($this->sockets, $write, $except, null);

            foreach ($this->sockets as $socket) {
//连接主机的 client
                if ($socket == $this->master) {
                    $client = socket_accept($this->master);
                    if ($client < 0) {
// debug
                        echo "socket_accept() failed";
                        continue;
                    } else {
//connect($client);
                        array_push($this->sockets, $client);
                        echo "connect client\n";
                    }
                } else {
                    $bytes = @socket_recv($socket, $buffer, 2048, 0);
//print_r($buffer);
                    if ($bytes == 0) {
                        return;
                    }

                    if (!$this->handshake) {
// 如果没有握手，先握手回应
                        $this->doHandShake($socket, $buffer);
                        echo "shakeHands\n";
                    } else {

// 如果已经握手，直接接受数据，并处理
                        $buffer = $this->decode($buffer);
//var_dump($buffer);
                        //process($socket, $buffer);
                        $this->send($socket, $buffer);
                        echo "send file\n";
                    }
                }
            }
        }
    }

    public function dohandshake($socket, $req)
    {
// 获取加密key
        $acceptKey = $this->encry($req);
        $upgrade = "HTTP/1.1 101 Switching Protocols\r\n" .
            "Upgrade: websocket\r\n" .
            "Connection: Upgrade\r\n" .
            "Sec-WebSocket-Accept: " . $acceptKey . "\r\n" .
            "\r\n";

        echo "dohandshake " . $upgrade . chr(0);
// 写入socket
        socket_write($socket, $upgrade . chr(0), strlen($upgrade . chr(0)));
// 标记握手已经成功，下次接受数据采用数据帧格式
        $this->handshake = true;
    }

    public function encry($req)
    {
        $key = $this->getKey($req);
        $mask = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

        return base64_encode(sha1($key . '258EAFA5-E914-47DA-95CA-C5AB0DC85B11', true));
    }

    public function getKey($req)
    {
        $key = null;
        if (preg_match("/Sec-WebSocket-Key: (.*)\r\n/", $req, $match)) {
            $key = $match[1];
        }
        return $key;
    }

// 解析数据帧
    public function decode($buffer)
    {
        $len = $masks = $data = $decoded = null;
        $len = ord($buffer[1]) & 127;

        if ($len === 126) {
            $masks = substr($buffer, 4, 4);
            $data = substr($buffer, 8);
        } else if ($len === 127) {
            $masks = substr($buffer, 10, 4);
            $data = substr($buffer, 14);
        } else {
            $masks = substr($buffer, 2, 4);
            $data = substr($buffer, 6);
        }
        for ($index = 0; $index < strlen($data); $index++) {
            $decoded .= $data[$index] ^ $masks[$index % 4];
        }
        return $decoded;
    }

// 返回帧信息处理
    public function frame($s)
    {
        $a = str_split($s, 125);
        if (count($a) == 1) {
            return "\x81" . chr(strlen($a[0])) . $a[0];
        }
        $ns = "";
        foreach ($a as $o) {
            $ns .= "\x81" . chr(strlen($o)) . $o;
        }
        return $ns;
    }

// 返回数据
    public function send($client, $msg)
    {
        $msg = $this->frame($msg);
//var_dump($msg);
        socket_write($client, $msg, strlen($msg));
    }

}
