import Pusher from 'pusher';

const pusher = new Pusher({
  appId: '1862105',
  key: '9a62ef4d6', 
  secret: '0a953af',
  cluster: 'ap2',
  useTLS: true,
  port: 443
});

export default pusher;