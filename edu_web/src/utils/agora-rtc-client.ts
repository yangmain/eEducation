import EventEmitter from 'events';
import AgoraRTC from 'agora-rtc-sdk';

export interface AgoraStreamSpec {
  streamID: number
  video: boolean
  audio: boolean
  mirror?: boolean
  screen?: boolean
  microphoneId?: string
  cameraId?: string
  audioOutput?: {
    volume: number
    deviceId: string
  }
}

const streamEvents: string[] = [
  "accessAllowed", 
  "accessDenied",
  "stopScreenSharing",
  "videoTrackEnded",
  "audioTrackEnded",
  "player-status-changed"
];

const clientEvents: string[] = [
  'stream-published',
  'stream-added',
  'stream-removed',
  'stream-subscribed',
  'peer-online',
  'peer-leave',
  'error',
  'network-type-changed',
  'network-quality',
  'exception',
]

export const APP_ID = process.env.REACT_APP_AGORA_APP_ID as string;
export const APP_TOKEN = process.env.REACT_APP_AGORA_APP_TOKEN as string;
export const ENABLE_LOG = process.env.REACT_APP_AGORA_LOG as string === "true";
export const SHARE_ID = 7;

class AgoraRTCClient {

  private streamID: any;
  public _init: boolean = false;
  public _joined: boolean = false;
  public _published: boolean = false;
  private _internalTimer: NodeJS.Timeout | any;
  public _client: any = AgoraRTC.createClient({mode: 'live', codec: 'h264'});
  public _bus: EventEmitter = new EventEmitter();
  public _localStream: any = null;

  constructor () {
    this.streamID = null;
  }

  // init rtc client when _init flag is false;
  async initClient(appId: string) {
    if (this._init) return;
    let prepareInit = new Promise((resolve, reject) => {
      this._init === false && this._client.init(appId, () => {
        this._init = true;
        resolve()
      }, reject);
    })
    await prepareInit;
    console.log("[smart-client] init client");
  }

  // create rtc client;
  async createClient(appId: string, enableRtt?: boolean) {
    await this.initClient(appId);
    this.subscribeClientEvents();
    if (enableRtt) {
      this._internalTimer = setInterval(() => {
        this._client.getTransportStats((stats: any) => {
          const RTT = stats.RTT ? stats.RTT : 0;
          this._bus.emit('watch-rtt', RTT);
        });
      }, 100);
    }
  }

  // destroy rtc client (only unsubscribe client events)
  destroyClient(): void {
    this.unsubscribeClientEvents();
  }

  subscribeClientEvents() {
    for (let evtName of clientEvents) {
      this._client.on(evtName, (args: any) => {
        this._bus.emit(evtName, args);
      });
    }
  }

  unsubscribeClientEvents() {
    for (let evtName of clientEvents) {
      this._client.off(evtName, () => {});
    }
  }

  subscribeLocalStreamEvents() {
    for (let evtName of streamEvents) {
      this._localStream.on(evtName, (args: any) => {
        this._bus.emit(evtName, args);
      });
    }
  }

  unsubscribeLocalStreamEvents() {
    if (this._localStream) {
      for (let evtName of streamEvents) {
        this._localStream.removeEventListener(evtName, (args: any[]) => {});
      }
    }
  }

  removeAllListeners() {
    this.unsubscribeClientEvents();
    this._bus.removeAllListeners();
  }

  // subscribe
  on(evtName: string, cb: (args: any) => void) {
    this._bus.on(evtName, cb);
  }

  // unsubscribe
  off(evtName: string, cb: (args: any) => void) {
    this._bus.off(evtName, cb);
  }

  async publish() {
    return new Promise((resolve, reject) => {
      if (this._published) {
        return resolve();
      }
      this._client.publish(this._localStream, (err: any) => {
        reject(err);
      })
      setTimeout(() => {
        resolve();
        this._published = true;
      }, 300);
    })
  }

  async unpublish() {
    return new Promise((resolve, reject) => {
      if (!this._published || !this._localStream) {
        return resolve();
      }
      this._client.unpublish(this._localStream, (err: any) => {
        reject(err);
      })
      setTimeout(() => {
        resolve();
        this.destroyLocalStream();
        this._published = false;
      }, 300);
    })
  }

  setRemoteVideoStreamType(stream: any, streamType: number) {
    this._client.setRemoteVideoStreamType(stream, streamType);
  }

  async enableDualStream() {
    return new Promise((resolve, reject) => {
      this._client.enableDualStream(resolve, reject);
    });
  }

  createLocalStream(data: AgoraStreamSpec): Promise<any> {
    this._localStream = AgoraRTC.createStream({...data, mirror: false});
    console.log("[smart-client] _localStream ", this._localStream);
    return new Promise((resolve, reject) => {
      this._localStream.init(() => {
        this.streamID = data.streamID;
        this.subscribeLocalStreamEvents();
        if (data.audioOutput && data.audioOutput.deviceId) {
          this.setAudioOutput(data.audioOutput.deviceId).then(() => {
            resolve();
          }).catch((err: any) => {
            reject(err);
          })
        }
        resolve();
      }, (err: any) => {
        reject(err);
      })
    });
  }

  destroyLocalStream () {
    this.unsubscribeLocalStreamEvents();
    if(this._localStream) {
      if (this._localStream.isPlaying()) {
        this._localStream.stop();
      }
      this._localStream.close();
    }
    this._localStream = null;
    this.streamID = 0;
  }

  async join (uid: number, channel: string) {
    return new Promise((resolve, reject) => {
      this._client.join(null, channel, +uid, resolve, reject);
    })
  }

  async leave () {
    if (this._client) {
      return new Promise((resolve, reject) => {
        this._client.leave(resolve, reject);
      })
    }
  }

  setAudioOutput(speakerId: string) {
    return new Promise((resolve, reject) => {
      this._client.setAudioOutput(speakerId, resolve, reject);
    })
  }

  setAudioVolume(volume: number) {
    this._client.setAudioVolume(volume);
  }

  subscribe(stream: any) {
    this._client.subscribe(stream, {video: true, audio: true}, (err: any) => {
      console.log('[rtc-client] subscribe failed: ', JSON.stringify(err));
    });
  }

  destroy (): void {
    this._internalTimer && clearInterval(this._internalTimer);
    this._internalTimer = null;
    this.destroyLocalStream();
  }

  async exit () {
    await this.leave();
    await this.destroy();
  }

  getDevices (): Promise<Device[]> {
    return new Promise((resolve, reject) => {
      AgoraRTC.getDevices((devices: any) => {
        const _devices: any[] = [];
        devices.map((item: any) => {
          _devices.push({deviceId: item.deviceId, kind: item.kind, label: item.label});
        })
        resolve(_devices);
      }, (err: any) => {
        reject(err);
      });
    })
  }
}

export default class AgoraWebClient {

  public readonly rtc: AgoraRTCClient;
  public shareClient: AgoraRTCClient | any;
  public localUid: number;
  public channel: string;
  public readonly bus: EventEmitter;
  public shared: boolean;
  public joined: boolean;
  public published: boolean;

  constructor() {
    this.localUid = 0;
    this.channel = '';
    this.rtc = new AgoraRTCClient();
    this.bus = new EventEmitter();
    this.shared = false;
    this.shareClient = null;
    this.joined = false;
    this.published = false;
  }

  async getDevices () {
    const client = new AgoraRTCClient();
    await client.initClient(APP_ID);
    await client.createLocalStream({
      streamID: 0,
      audio: true,
      video: true,
      microphoneId: '',
      cameraId: ''
    });
    setTimeout(() => {
      client.destroyLocalStream();
    }, 80);
    return client.getDevices();
  }

  async joinChannel(uid: number, channel: string, dual: boolean) {
    this.localUid = uid;
    this.channel = channel;
    await this.rtc.createClient(APP_ID, true);
    await this.rtc.join(this.localUid, channel);
    dual && await this.rtc.enableDualStream();
    this.joined = true;
  }

  async leaveChannel() {
    this.localUid = 0;
    this.channel = '';
    await this.unpublishLocalStream();
    await this.rtc.leave();
    this.rtc.destroy();
    this.rtc.destroyClient();
    this.joined = false;
  }

  async enableDualStream() {
    return this.rtc.enableDualStream();
  }

  async publishLocalStream(data: AgoraStreamSpec) {
    console.log(" publish local stream ", this.published);
    if (this.published) {
      await this.unpublishLocalStream();
      console.log("[smart-client] unpublished", this.published);
    }
    await this.rtc.createLocalStream(data);
    await this.rtc.publish();
    this.published = true;
  }

  async unpublishLocalStream() {
    console.log("[smart-client] unpublishStream");
    await this.rtc.unpublish();
    this.published = false;
  }

  async startScreenShare () {
    this.shareClient = new AgoraRTCClient();
    await this.shareClient.createLocalStream({
      video: false,
      audio: true,
      screen: true,
      streamID: SHARE_ID,
      microphoneId: '',
      cameraId: ''
    })
    await this.shareClient.createClient(APP_ID);
    await this.shareClient.join(SHARE_ID, this.channel);
    await this.shareClient.publish();
    this.shared = true;
  }

  async stopScreenShare () {
    await this.shareClient.unpublish();
    await this.shareClient.leave();
    await this.shareClient.destroy();
    await this.shareClient.destroyClient();
    this.shared = false;
  }

  async exit () {
    await this.leaveChannel();
    if (this.shared === true) {
      await this.shareClient.unpublish();
      await this.shareClient.leave();
    }
    if (this.shareClient) {
      await this.shareClient.destroy();
      await this.shareClient.destroyClient();
    }
  }

  async createPreviewStream({cameraId, microphoneId, speakerId}: any) {
    const tmpStream = AgoraRTC.createStream({
      video: true,
      audio: true,
      screen: false,
      cameraId,
      microphoneId,
      speakerId
    })
    return new Promise((resolve, reject) => {
      tmpStream.init(() => {
        resolve(tmpStream);
      }, (err: any) => {
        reject(err);
      })
    });
  }

  subscribe(stream: any) {
    this.rtc.subscribe(stream);
  }

  setRemoteVideoStreamType(stream: any, type: number) {
    this.rtc.setRemoteVideoStreamType(stream, type);
  }
}