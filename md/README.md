# DNet：一种级联的DDNN推断框架

## 整体结构

![整体结构](./_/整体结构.svg)

* 系统由一系列计算单元构成，每个计算单元接收计算请求，并返回计算结果
* 如果一个分块计算单元上的计算结果未能达到指定阈值，则计算单元自动向之后的分块计算单元发送计算请求，并将结果转发给请求方
  * 所谓“请求方”可以是终端，也可以是前一个分块计算单元
* 计算单元可以无限制地级联，而无所谓是在云端还是边缘

## 计算单元结构

![单元结构](./_/系统结构.svg)

* 计算层（包括神经网络+分支退出阈值）
  * 单线程执行，不允许抢占（避免GPU换入换出耗时）
  * 输入前一个单元传来的矩阵和起始层数
  * 执行神经网络计算，比较退出阈值
  * 输出
    * 阈值满足要求时：识别结果
    * 阈值不满足要求时：下一个单元的输入
* 传输层（包括下一个单元的请求地址）
  * 并发，需要端口复用
  * 接收前一个单元传来的矩阵和起始层数
  * 输入到计算层执行计算，等待计算结果
  * 输出
    * 如果计算层返回了识别结果，则返回
    * 如果计算层返回了下一个单元的输入，则请求下一个单元，等待并返回下一个单元的返回值
  * 计算层输出计算结果后立即开始计算下一个输入
* 中间层（基于RabbitMQ队列的RPC系统）
  * 负责计算层和传输层之间的通信
  * 此层的存在只是因为多语言编程和异步的需要，如果计算层和传输层由同种语言异步实现，则不需要传输层
  * 传输层将收到的数据传到中间层队列中，并等待返回
  * 计算层从中间层队列中接收数据，执行计算，返回结果

### 单传输层多计算层

* 一个计算单元中可以有多个计算层处理计算请求
* 传输层通过AMQP协议中的“消息ID”机制将计算请求和计算结果一一对应
* 不可以有多个传输层，因为消息ID不能在传输层间共享

![多计算层结构](./_/多计算层结构.svg)

## 运行计算层

### 直接运行

```sh
$ python ComputationUnit -h
Usage: ComputationUnit [options]

Options:
  -h, --help            show this help message and exit
  -a ADDRESS, --address=ADDRESS
                        要连接的RabbitMQ服务器地址和端口
  -q QUEUENAME, --queuename=QUEUENAME
                        接收计算请求的RabbitMQ队列名
  -e EXITLAYER, --exitlayer=EXITLAYER
                        出口位置
```

#### 示例

```sh
git clone https://github.com/yindaheng98/torch-models
mv ./torch-models/multi-exit-inception-v3-cifar10-epoch53.pkl ./ComputationUnit/multi-exit-inception-v3-cifar10-epoch53.pkl
rm -rf ./torch-models
# 模型文件太大于是给放到别的repo里面了，要先下载才能运行

python -m venv ./ComputationUnit/venv
./ComputationUnit/venv/Scripts/activate.ps1
pip install -r ./ComputationUnit/requirements.txt
pip install torch==1.7.0+cpu torchvision==0.8.1+cpu torchaudio===0.7.0 -f https://download.pytorch.org/whl/torch_stable.html
#装好环境

docker run -it --rm --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:alpine
python ComputationUnit -a 192.168.1.2 -q q8 -e 8 # 连到192.168.1.2、队列名q8、从第8层退出
python ComputationUnit -a 192.168.1.2 -q q12 -e 12 # 连到192.168.1.2、队列名q12、从第12层退出
python ComputationUnit -a 192.168.1.2 -q q16 -e 16 # 连到192.168.1.2、队列名q16、从第16层退出
```

### Docker运行

Dockerhub地址是[yindaheng98/dnet-computationunit](https://hub.docker.com/repository/docker/yindaheng98/dnet-computationunit)。内置模型文件无需额外下载，运行指令同上。

```sh
docker run -it --rm --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:alpine
docker run --rm -it yindaheng98/dnet-computationunit python ComputationUnit -a 192.168.56.1 -q q8 -e 8 # 连到192.168.56.1、队列名q8、从第8层退出
docker run --rm -it yindaheng98/dnet-computationunit python ComputationUnit -a 192.168.56.1 -q q12 -e 12 # 连到192.168.56.1、队列名q12、从第12层退出
docker run --rm -it yindaheng98/dnet-computationunit python ComputationUnit -a 192.168.56.1 -q q16 -e 16 # 连到192.168.56.1、队列名q16、从第16层退出
```

## 运行传输层

### 直接运行

```sh
$ cd TransmissionUnit
$ npm run start -- -h

Usage: index [options]

Options:
  -V, --version                          output the version number
  -l, --listen-address <listen-address>  gRPC服务器将要监听的IP地址和端口 (default: "0.0.0.0:8080")
  -a, --amqp-address <amqp-address>      与计算层通讯的RabbitMQ服务器接口地址 (default: "amqp://localhost")
  -q, --queue-name <queue-name>          与计算层通讯的RabbitMQ队列名称 (default: "ComputationQueue")
  -n, --next-address <next-address>      如果此服务器运行在边缘，此处指定下一套模型（云端）的gRPC服务器位置 (default: "")
  -h, --help                             display help for command
```

#### 示例

```sh
npm run start -- -l 0.0.0.0:8082 -a amqp://192.168.1.2 -q q16
npm run start -- -l 0.0.0.0:8081 -a amqp://192.168.1.2 -q q12 -n localhost:8082
npm run start -- -l 0.0.0.0:8080 -a amqp://192.168.1.2 -q q8 -n localhost:8081
```

### Docker运行

Dockerhub地址是[yindaheng98/dnet-transmissionunit](https://hub.docker.com/repository/docker/yindaheng98/dnet-transmissionunit)。运行指令同上。

```sh
docker run --rm -it -p 8082:8080 yindaheng98/dnet-transmissionunit npm run start -- -a amqp://192.168.56.1 -q q16
docker run --rm -it -p 8081:8080 yindaheng98/dnet-transmissionunit npm run start -- -a amqp://192.168.56.1 -q q12 -n 192.168.56.1:8082
docker run --rm -it -p 8080:8080 yindaheng98/dnet-transmissionunit npm run start -- -a amqp://192.168.56.1 -q q8 -n 192.168.56.1:8081
```

## 运行测试

### 直接运行

```sh
$ cd test
$ python TransmissionUnit.test.py -h
Usage: TransmissionUnit.test.py [options]

Options:
  -h, --help            show this help message and exit
  -a ADDRESS, --address=ADDRESS
                        要测试服务器地址和端口
  -n NUMBER, --number=NUMBER
                        测试多少张图片
  -e EXIT, --exit=EXIT  在第几层退出
```

#### 示例

```sh
python -m venv ./ComputationUnit/venv
./ComputationUnit/venv/Scripts/activate.ps1
pip install -r ./ComputationUnit/requirements.txt
#装好环境

cd test
python load_data.py
# 加载数据集

python TransmissionUnit.test.py -a 192.168.56.1:8080
```

### Docker运行

Dockerhub地址是[yindaheng98/dnet-testunit](https://hub.docker.com/repository/docker/yindaheng98/dnet-testunit)。运行指令同上。

```sh
docker run --rm -it yindaheng98/dnet-testunit python TransmissionUnit.test.py -a 192.168.56.1:8080
```

## K8S部署示例

k8s部署示例yaml文件位于`example`文件夹。

两种方案中执行测试均可用如下语句：

```sh
python TransmissionUnit.test.py -a localhost:8080
```

或者

```sh
kubectl run -i --tty dnet-testunit --image=yindaheng98/dnet-testunit --restart=Never --command -- python TransmissionUnit.test.py -a dnet-unit-8:8080
kubectl delete po dnet-testunit
```

### 示例一：每个Pod中都包含计算层、传输层和队列系统各一个

示例yaml文件位于`example/one-hot`文件夹。

这种部署方式下，每个Pod中都有计算层、传输层和队列系统，虽然简单易维护但是比较占资源。

一共划分为4种计算单元，退出层分别是4、8、12、16层，每个计算单元有3个备份。

部署：

```sh
URL=https://raw.githubusercontent.com/yindaheng98/DNet/main/example
kubectl apply -f $URL/one-hot/dnet-unit-8.yaml
kubectl apply -f $URL/one-hot/dnet-unit-12.yaml
kubectl apply -f $URL/one-hot/dnet-unit-16.yaml
kubectl apply -f $URL/dnet-nodeport.yaml
```

删除：

```sh
kubectl delete svc dnet-nodeport
kubectl delete svc dnet-unit-8
kubectl delete deploy dnet-unit-8
kubectl delete svc dnet-unit-12
kubectl delete deploy dnet-unit-12
kubectl delete svc dnet-unit-16
kubectl delete deploy dnet-unit-16
```

### 示例二：计算层、传输层和队列系统部署在不同的Pod中

示例yaml文件位于`example/distrib`文件夹。

这种部署方式比较自由，各部分可以根据负载情况动态地调整部署规模，适合于边缘环境下各设备算力不同的情况，代价是需要运维人员关心各层间的关系，维护起来比较复杂。

一共划分为4种计算单元，退出层分别是4、8、12、16层。每个计算层单元有3个备份，每个传输层单元有一个备份，它们共用一个队列系统，不同层的计算任务在名称不同的队列中传输。

注：按照开头介绍的那套系统架构，由于每个计算层单元的3个备份都从同一个队列中执行计算任务，因此传输层单元不可以有多个备份

```sh
URL=https://raw.githubusercontent.com/yindaheng98/DNet/main/example
kubectl apply -f $URL/distrib/dnet-queue.yaml
kubectl apply -f $URL/distrib/dnet-transmissionunit-8.yaml
kubectl apply -f $URL/distrib/dnet-transmissionunit-12.yaml
kubectl apply -f $URL/distrib/dnet-transmissionunit-16.yaml
kubectl apply -f $URL/distrib/dnet-computationunit-16.yaml
kubectl apply -f $URL/distrib/dnet-computationunit-12.yaml
kubectl apply -f $URL/distrib/dnet-computationunit-8.yaml
kubectl apply -f $URL/dnet-nodeport.yaml
```

删除：

```sh
kubectl delete svc dnet-nodeport
kubectl delete deploy dnet-computationunit-8
kubectl delete deploy dnet-computationunit-12
kubectl delete deploy dnet-computationunit-16
kubectl delete svc dnet-unit-8
kubectl delete deploy dnet-transmissionunit-8
kubectl delete svc dnet-unit-12
kubectl delete deploy dnet-transmissionunit-12
kubectl delete svc dnet-unit-16
kubectl delete deploy dnet-transmissionunit-16
kubectl delete svc dnet-queue
kubectl delete deploy dnet-queue
```

## 问题解决集锦

### 2020-11-18 学院停电

学院停电导致ubuntu树莓派未正常关机，开机后无法写文件

```sh
fsck.ext4 -y /dev/mmcblk0p2
shutdown -r now
```

### 2020-11-18 Dockerhub网速太慢

Dockerhub太慢导致镜像下不下来

找一台性能好点的主机开个缓存镜像

```sh
docker run -d -p 80:5000 --restart=always --name=pull-through-cache \
  -e REGISTRY_PROXY_REMOTEURL="https://4h50gpde.mirror.aliyuncs.com" \
  -e REGISTRY_PROXY_USERNAME=yindaheng98 \
  -e REGISTRY_PROXY_PASSWORD=YHM19980228yhm \
  registry
```

然后在网速比较慢的机器上面写入镜像地址，注意不要覆盖了`/etc/docker/daemon.json`里面原本的设置。

比如在服务器上：

```sh
echo '{"registry-mirrors": ["http://192.168.3.4"],"exec-opts": ["native.cgroupdriver=systemd"]}' > /etc/docker/daemon.json
systemctl daemon-reload
systemctl restart docker
```

树莓派上：

```sh
echo '{"registry-mirrors": ["http://192.168.3.4"]}' > /etc/docker/daemon.json
systemctl daemon-reload
systemctl restart docker
```

尽最大可能减少边缘从云端下载镜像的情况。

### 2020-11-20 手工批量执行速度太慢

用`expect`做一个函数用于与树莓派自动交互：

```sh
function PiRunCmd(){
ips=("192.168.3.51" "192.168.3.52" "192.168.3.53" "192.168.3.54")
username="ubuntu"
password="raspberry"

for ((k = 0; k < ${#ips[@]}; k++)); do
command=$($1 `expr $k + 1`)
ip=${ips[$k]}
expect << EOF
    set timeout -1
    spawn ssh $username@$ip
    expect {
        "*yes/no" { send "yes\r"; exp_continue }
        "*password:" { send "$password\r" }
    }
    expect "ubuntu@ubuntu"
    send "su\r"
    expect "*Password:"
    send "$password\r"
    expect "*#"
    send "$command\r"
    expect "*#"
    send "exit\r"
    expect "ubuntu@ubuntu"
    send "exit\r"
    expect eof
EOF
done
}
```

同样的原理，用`expect`做一个函数用于与服务器自动交互：

```sh
function ServerRunCmd(){
ips=("192.168.3.11" "192.168.3.12")
usernames=("hzw1" "hzw2")
passwords=("123" "123")

for ((k = 0; k < ${#ips[@]}; k++)); do
command=$($1 `expr $k + 1`)
ip=${ips[$k]}
username=${usernames[$k]}
password=${passwords[$k]}
expect << EOF
    set timeout -1
    spawn ssh $username@$ip
    expect {
        "*yes/no" { send "yes\r"; exp_continue }
        "*password:" { send "$password\r" }
    }
    expect "hzw*@"
    send "su\r"
    expect "*Password:"
    send "$password\r"
    expect "*#"
    send "$command\r"
    expect "*#"
    send "exit\r"
    expect "hzw*@"
    send "exit\r"
    expect eof
EOF
done
}
```

#### 2020-11-20 重置树莓派集群

```sh
function ResetCmd(){
echo "keadm reset"
}
PiRunCmd ResetCmd
```

#### 2020-11-20 初始化树莓派集群

```sh
function InitCmd(){
token="6da4928430db3b282e7e38374fee472dfeec2f9bc100fcbfa8626dcd8c581fee.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDU5Nzk5ODF9.NY_I9B9ApvEX9MmaeGvM39XT84JhXizf9pyF3jHJiFY"
proxy="http://10.201.154.168:10800/"
echo "echo -e 'http_proxy=$proxy\nhttps_proxy=$proxy\nuse_proxy = on' > ~/.wgetrc && keadm join --kubeedge-version=1.4.0 --cloudcore-ipport=192.168.3.11:10000 --edgenode-name=edge0$1 --token=$token && rm ~/.wgetrc"
}
PiRunCmd InitCmd
```

#### 2020-11-20 下载Ingress镜像

```sh
function IngressCmd(){
proxy="http://10.201.154.168:10800/"
command="mkdir -p /etc/systemd/system/docker.service.d && echo -e '\[Service\]\nEnvironment=\\\"HTTP_PROXY=$proxy\\\" \\\"HTTPS_PROXY=$proxy\\\" \\\"NO_PROXY=\\\"' >> /etc/systemd/system/docker.service.d/http-proxy.conf && systemctl daemon-reload && systemctl restart docker"
command="$command && docker pull us.gcr.io/k8s-artifacts-prod/ingress-nginx/controller:v0.34.1@sha256:0e072dddd1f7f8fc8909a2ca6f65e76c5f0d2fcfb8be47935ae3457e8bbceb20 && docker pull docker.io/jettech/kube-webhook-certgen:v1.2.2"
command="$command && rm -rf /etc/systemd/system/docker.service.d && systemctl daemon-reload && systemctl restart docker"
echo "$command"
}
PiRunCmd IngressCmd
ServerRunCmd IngressCmd
```

#### 2020-11-20 设置Dockerhub镜像源

```sh
function GenCmd(){
echo "echo -e '{\\\"registry-mirrors\\\": \[\\\"http://192.168.3.4\\\"\]}' > /etc/docker/daemon.json && systemctl daemon-reload && systemctl restart docker"
}
PiRunCmd GenCmd
function GenCmd(){
echo "echo '{\\\"registry-mirrors\\\": \[\\\"http://192.168.3.4\\\"\],\\\"exec-opts\\\": \[\\\"native.cgroupdriver=systemd\\\"\]}' > /etc/docker/daemon.json && systemctl daemon-reload && systemctl restart docker"
}
ServerRunCmd GenCmd
```

#### 2020-11-20 下载DNet所需的镜像

```sh
function DownCmd(){
echo "docker pull yindaheng98/dnet-transmissionunit && docker pull yindaheng98/dnet-computationunit && docker pull rabbitmq:alpine"
}
PiRunCmd DownCmd
ServerRunCmd DownCmd
```

#### 2020-11-20 重置Dockerhub镜像源

```sh
function DelCmd(){
echo "rm /etc/docker/daemon.json && systemctl daemon-reload && systemctl restart docker"
}
PiRunCmd DelCmd
ServerRunCmd DelCmd
```

#### 2020-11-21 不知为何树莓派处又要拉取`k8s.gcr.io/kube-proxy:v1.19.4`

```sh
function IngressCmd(){
proxy="http://10.201.154.168:10800/"
command="mkdir -p /etc/systemd/system/docker.service.d && echo -e '\[Service\]\nEnvironment=\\\"HTTP_PROXY=$proxy\\\" \\\"HTTPS_PROXY=$proxy\\\" \\\"NO_PROXY=\\\"' >> /etc/systemd/system/docker.service.d/http-proxy.conf && systemctl daemon-reload && systemctl restart docker"
command="$command && docker pull k8s.gcr.io/kube-proxy:v1.19.4"
command="$command && rm -rf /etc/systemd/system/docker.service.d && systemctl daemon-reload && systemctl restart docker"
echo "$command"
}
PiRunCmd IngressCmd
```

## 问题与思考

### 镜像分发问题

#### 问题描述

* 深度学习相关的容器基础镜像大小基本都是100M以上，涉及显卡驱动的基础镜像达到1G大小稀松平常
* 即使不算基础镜像，镜像中的保存神经网络模型的文件大小也很容易达到100M
* 在边缘计算所假定的云边网速不高的情况下，从云端直接下载镜像速度很慢还容易失败

镜像的下载本质上也是HTTP请求，这显然是一个CDN中内容分发的问题，可以使用CDN中一些已经比较成熟的方法解决。

以下解决方案是在实验室环境中，没有强大的CDN支持情况下的无奈之举。

#### 目前的解决方案

解决方案：Dockerhub pull-through cache。

Dockerhub pull-through cache 是指部署于本地的、运行于pull-through cache模式的DockerRegistry，它会代替设备从Dockerhub拉取镜像并缓存，下次再拉取同一个镜像的时候就不用再请求Dockerhub了。

在边缘侧，Docker通过配置文件中填入的镜像服务器的接口地址找到pull-through cache的位置。

#### 当前解决方案的扩展形式

##### 级联

Dockerhub pull-through cache在启动时会指定一个镜像源地址，这个地址除了可以是Dockerhub镜像源`https://registry-1.docker.io`外，还可以是另一个Dockerhub pull-through cache，因此它是可以级联的。

级联时，一个pull-through cache可以直接服务于设备，也可以为附近的其他pull-through cache提供服务，以最大程度地避免从云端下载镜像的过程。

##### 并联

一个设备上可以填土多个pull-through cache地址，Docker会自动选择可用的地址下载镜像。

#### 当前方案没有解决的问题

##### 不能主动更新pull-through cache中缓存的镜像

在实际测试中，在云端镜像更新后很长时间，才能从pull-through cache中拉取到最新的镜像。pull-through cache中缓存的镜像似乎是定期清除的，不能主动更新。

##### 只能连接到Dockerhub及Dockerhub pull-through cache

未能找到对其他容器镜像源（例如`https://k8s.gcr.io`）做pull-through cache的方法。

直接在启动时会指定一个镜像源地址为`https://k8s.gcr.io`的方法有待尝试。Docker如何通过不同的地址找对应的pull-through cache地址也是个问题。

###### 另一个思路

自带缓存的代理服务器`https://github.com/rpardini/docker-registry-proxy`。如果能在服务器内再指定下载镜像的代理服务器的话，那这个服务器就是能级联的，能解决上面pull-through cache只能连接到Dockerhub的问题。

```sh
proxy='http://10.201.154.168:10800'
wget $proxy/ca.crt -O /usr/share/ca-certificates/docker_registry_proxy.crt
update-ca-certificates --fresh
mkdir -p /etc/systemd/system/docker.service.d && echo -e "[Service]\nEnvironment=\"HTTP_PROXY=$proxy\" \"HTTPS_PROXY=$proxy\" \"NO_PROXY=\"" > /etc/systemd/system/docker.service.d/http-proxy.conf && systemctl daemon-reload && systemctl restart docker
systemctl daemon-reload
systemctl restart docker
```

##### 为pull-through cache设置代理

翻墙下载镜像速度更快。

##### 要手动配置

因为这是涉及到docker配置的问题，因此没法用k8s统一配置，只能写脚本一个个配。
