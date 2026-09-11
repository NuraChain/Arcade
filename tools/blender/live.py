import json
import socket
import sys

HOST = '127.0.0.1'
PORT = 9876


def send(command, params=None, timeout=120.0):
    payload = json.dumps({'type': command, 'params': params or {}}).encode('utf-8')
    with socket.create_connection((HOST, PORT), timeout=timeout) as sock:
        sock.sendall(payload)
        chunks = []
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            try:
                return json.loads(b''.join(chunks).decode('utf-8'))
            except json.JSONDecodeError:
                continue
    raise RuntimeError('connection closed before a complete reply')


def execute(code):
    reply = send('execute_code', {'code': code})
    if reply.get('status') != 'success':
        raise RuntimeError(reply.get('message', reply))
    return reply.get('result', {})


def screenshot(path, max_size=1200):
    reply = send('get_viewport_screenshot', {'filepath': path, 'max_size': max_size, 'format': 'png'})
    if reply.get('status') != 'success':
        raise RuntimeError(reply.get('message', reply))
    return reply.get('result', {})


def scene_info():
    reply = send('get_scene_info')
    return reply.get('result', reply)


def main(argv):
    if len(argv) < 2:
        print('usage: live.py info | shot <out.png> | exec <file.py> | run "<code>"')
        return 2
    verb = argv[1]
    if verb == 'info':
        print(json.dumps(scene_info(), indent=2)[:4000])
    elif verb == 'shot':
        print(screenshot(argv[2]))
    elif verb == 'exec':
        with open(argv[2], encoding='utf-8') as handle:
            print(execute(handle.read()))
    elif verb == 'run':
        print(execute(argv[2]))
    else:
        print('unknown verb', verb)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
