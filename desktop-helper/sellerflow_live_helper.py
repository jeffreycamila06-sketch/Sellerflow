import asyncio
import base64
import ctypes
import hashlib
import json
import os
import queue
import socket
import struct
import threading
import time
from typing import Any
from ctypes import wintypes

HOST = "127.0.0.1"
PORT = 8588
MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
HICON = ctypes.c_void_p
HCURSOR = ctypes.c_void_p
HBRUSH = ctypes.c_void_p
HINSTANCE = ctypes.c_void_p


class RawPrinter:
    def __init__(self, logger):
        self.logger = logger
        self.winspool = ctypes.WinDLL("winspool.drv", use_last_error=True)

    def default_printer(self) -> str:
        needed = ctypes.c_ulong(0)
        self.winspool.GetDefaultPrinterW(None, ctypes.byref(needed))
        if needed.value == 0:
            raise RuntimeError("Printer not found: Windows has no default printer.")
        buffer = ctypes.create_unicode_buffer(needed.value)
        if not self.winspool.GetDefaultPrinterW(buffer, ctypes.byref(needed)):
            raise ctypes.WinError(ctypes.get_last_error())
        return buffer.value

    def write_raw(self, data: bytes, printer_name: str | None = None):
        name = printer_name or os.environ.get("SELLERFLOW_PRINTER") or self.default_printer()
        handle = ctypes.c_void_p()
        if not self.winspool.OpenPrinterW(ctypes.c_wchar_p(name), ctypes.byref(handle), None):
            raise RuntimeError(f"Printer not found or not accessible: {name}")

        class DOC_INFO_1(ctypes.Structure):
            _fields_ = [
                ("pDocName", ctypes.c_wchar_p),
                ("pOutputFile", ctypes.c_wchar_p),
                ("pDatatype", ctypes.c_wchar_p),
            ]

        doc = DOC_INFO_1("SellerFlowLive Order", None, "RAW")
        try:
            if not self.winspool.StartDocPrinterW(handle, 1, ctypes.byref(doc)):
                raise ctypes.WinError(ctypes.get_last_error())
            if not self.winspool.StartPagePrinter(handle):
                raise ctypes.WinError(ctypes.get_last_error())
            written = ctypes.c_ulong(0)
            buffer = ctypes.create_string_buffer(data)
            if not self.winspool.WritePrinter(handle, buffer, len(data), ctypes.byref(written)):
                raise ctypes.WinError(ctypes.get_last_error())
            self.winspool.EndPagePrinter(handle)
            self.winspool.EndDocPrinter(handle)
            self.logger(f"Printed {written.value} bytes to {name}")
        finally:
            self.winspool.ClosePrinter(handle)


def escpos_order(payload: dict[str, Any]) -> bytes:
    buyer = payload.get("buyer") or payload.get("order", {}).get("buyer") or {}
    orders = buyer.get("orders") or payload.get("orders") or []
    settings = payload.get("settings") or {}
    currency = payload.get("currency") or "PHP"
    store = payload.get("storeName") or payload.get("store_name") or "SellerFlowLive"
    session = payload.get("sessionDate") or time.strftime("%Y-%m-%d")
    name = buyer.get("name") or payload.get("customer_name") or "Customer"
    handle = buyer.get("handle") or payload.get("handle") or ""
    buyer_num = buyer.get("num") or payload.get("buyer_number") or ""
    total = buyer.get("totalSpent") or payload.get("total") or 0

    def line(text=""):
        return f"{text}\n".encode("cp437", errors="replace")

    out = bytearray()
    out += b"\x1b@"  # initialize
    out += b"\x1bt\x00"
    out += b"\x1ba\x01" + b"\x1bE\x01" + line("SellerFlowLive") + b"\x1bE\x00"
    if settings.get("printStoreName", True):
        out += line(store)
    out += line("-" * 32)
    out += b"\x1bE\x01" + line(f"BUYER #{buyer_num}") + b"\x1bE\x00"
    out += line(name)
    if handle and settings.get("printBuyerUsername", True):
        out += line(f"@{handle}")
    out += line(f"Session: {session}")
    out += line("-" * 32)
    if settings.get("printOrderItems", True):
        out += b"\x1ba\x00"
        for item in orders[-12:]:
            order_no = item.get("orderNum") or item.get("order_no") or ""
            item_name = item.get("item") or item.get("product") or "Live comment order"
            qty = item.get("qty") or 1
            amount = item.get("total") or item.get("price") or 0
            out += line(f"#{order_no} {item_name}")
            out += line(f"  x{qty} {currency}{amount}")
    if settings.get("printTotal", True):
        out += line("-" * 32)
        out += b"\x1bE\x01" + line(f"TOTAL: {currency}{total}") + b"\x1bE\x00"
    out += b"\x1ba\x01" + line("Thank you")
    out += b"\n\n\n\x1dV\x00"
    return bytes(out)


class SellerFlowHelper:
    WM_APP_LOG = 0x8001
    ID_START = 101
    ID_STOP = 102

    def __init__(self):
        self.user32 = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        self.server_thread: threading.Thread | None = None
        self.server_loop: asyncio.AbstractEventLoop | None = None
        self.server: asyncio.AbstractServer | None = None
        self.stop_event: asyncio.Event | None = None
        self.print_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self.log_queue: queue.Queue[str] = queue.Queue()
        self.log_text = ""
        self.status_text = "SERVER STOPPED"
        self.hwnd = None
        self.log_edit = None
        self.status_label = None
        self._wndproc_ref = None
        self.printer = RawPrinter(self.log)
        threading.Thread(target=self._print_worker, daemon=True).start()

    def _create_window(self):
        hinstance = self.kernel32.GetModuleHandleW(None)
        WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        self._wndproc_ref = WNDPROC(self._wndproc)

        class WNDCLASS(ctypes.Structure):
            _fields_ = [
                ("style", wintypes.UINT),
                ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int),
                ("hInstance", HINSTANCE),
                ("hIcon", HICON),
                ("hCursor", HCURSOR),
                ("hbrBackground", HBRUSH),
                ("lpszMenuName", wintypes.LPCWSTR),
                ("lpszClassName", wintypes.LPCWSTR),
            ]

        wc = WNDCLASS()
        wc.lpfnWndProc = self._wndproc_ref
        wc.hInstance = hinstance
        wc.hCursor = self.user32.LoadCursorW(None, 32512)
        wc.hbrBackground = HBRUSH(6)
        wc.lpszClassName = "SellerFlowLiveHelperWindow"
        self.user32.RegisterClassW(ctypes.byref(wc))

        self.hwnd = self.user32.CreateWindowExW(
            0,
            wc.lpszClassName,
            "SELLERFLOW LIVE SERVER",
            0x00CF0000,
            120,
            120,
            660,
            470,
            None,
            None,
            hinstance,
            None,
        )
        if not self.hwnd:
            raise ctypes.WinError(ctypes.get_last_error())
        self._build_controls(hinstance)
        self.user32.ShowWindow(self.hwnd, 1)
        self.user32.UpdateWindow(self.hwnd)
        self.user32.SetTimer(self.hwnd, 1, 200, None)

    def _build_controls(self, hinstance):
        self.user32.CreateWindowExW(0, "STATIC", "SELLERFLOW LIVE SERVER", 0x50000000, 18, 14, 420, 28, self.hwnd, None, hinstance, None)
        self.status_label = self.user32.CreateWindowExW(0, "STATIC", self.status_text, 0x50000000, 18, 44, 260, 24, self.hwnd, None, hinstance, None)
        self.user32.CreateWindowExW(0, "BUTTON", "Start Server", 0x50010000, 18, 76, 130, 34, self.hwnd, self.ID_START, hinstance, None)
        self.user32.CreateWindowExW(0, "BUTTON", "Stop Server", 0x50010000, 158, 76, 130, 34, self.hwnd, self.ID_STOP, hinstance, None)
        self.log_edit = self.user32.CreateWindowExW(
            0x00000200,
            "EDIT",
            "",
            0x503110C4,
            18,
            122,
            610,
            295,
            self.hwnd,
            None,
            hinstance,
            None,
        )

    def _wndproc(self, hwnd, msg, wparam, lparam):
        if msg == 0x0111:
            command_id = int(wparam) & 0xFFFF
            if command_id == self.ID_START:
                self.start_server()
                return 0
            if command_id == self.ID_STOP:
                self.stop_server()
                return 0
        if msg == 0x0113:
            self._drain_logs()
            return 0
        if msg == 0x0010:
            self.stop_server()
            self.user32.DestroyWindow(hwnd)
            return 0
        if msg == 0x0002:
            self.user32.PostQuitMessage(0)
            return 0
        return self.user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    def _set_status(self, value: str):
        self.status_text = value
        if self.status_label:
            self.user32.SetWindowTextW(self.status_label, value)

    def log(self, message: str):
        stamp = time.strftime("%H:%M:%S")
        self.log_queue.put(f"[{stamp}] {message}\r\n")

    def _drain_logs(self):
        while True:
            try:
                message = self.log_queue.get_nowait()
            except queue.Empty:
                break
            if self.log_edit:
                self.log_text = (self.log_text + message)[-30000:]
                self.user32.SetWindowTextW(self.log_edit, self.log_text)
                self.user32.SendMessageW(self.log_edit, 0x00B1, len(self.log_text), len(self.log_text))

    def start_server(self):
        if self.server_thread and self.server_thread.is_alive():
            self.log("Server already running.")
            return
        self.server_thread = threading.Thread(target=self._run_server_loop, daemon=True)
        self.server_thread.start()

    def stop_server(self):
        if self.server_loop and self.stop_event:
            self.server_loop.call_soon_threadsafe(self.stop_event.set)
            self._set_status("SERVER STOPPED")
            self.log("Stop requested.")

    def _run_server_loop(self):
        self.server_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.server_loop)
        self.stop_event = asyncio.Event()
        self.server_loop.run_until_complete(self._start_async_server())
        self.server_loop.close()

    async def _start_async_server(self):
        try:
            self.server = await asyncio.start_server(self._client, HOST, PORT)
            self._set_status("SERVER RUNNING")
            self.log(f"WebSocket server running at ws://{HOST}:{PORT}")
            await self.stop_event.wait()
        except OSError as exc:
            self._set_status("SERVER STOPPED")
            self.log(f"Cannot start server: {exc}")
        finally:
            if self.server:
                self.server.close()
                await self.server.wait_closed()
            self._set_status("SERVER STOPPED")
            self.log("WebSocket server stopped.")

    async def _client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        peer = writer.get_extra_info("peername")
        try:
            await self._handshake(reader, writer)
            self.log(f"Dashboard/browser connected: {peer}")
            await self._send_json(writer, {"type": "server_status", "status": "running"})
            while not reader.at_eof():
                opcode, data = await asyncio.wait_for(self._read_frame(reader), timeout=35)
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    await self._send_pong(writer, data)
                    continue
                if opcode == 0xA:
                    continue
                if opcode != 0x1:
                    continue
                await self._handle_message(data.decode("utf-8", errors="replace"), writer)
        except asyncio.TimeoutError:
            self.log("WebSocket disconnected: heartbeat timeout.")
        except Exception as exc:
            self.log(f"WebSocket disconnected: {exc}")
        finally:
            writer.close()
            await writer.wait_closed()

    async def _handshake(self, reader, writer):
        headers = b""
        while b"\r\n\r\n" not in headers:
            chunk = await reader.read(1024)
            if not chunk:
                raise RuntimeError("Empty WebSocket handshake.")
            headers += chunk
            if len(headers) > 8192:
                raise RuntimeError("Handshake too large.")
        text = headers.decode("latin1")
        key = ""
        for line in text.split("\r\n"):
            if line.lower().startswith("sec-websocket-key:"):
                key = line.split(":", 1)[1].strip()
                break
        if not key:
            raise RuntimeError("Missing Sec-WebSocket-Key.")
        accept = base64.b64encode(hashlib.sha1((key + MAGIC).encode()).digest()).decode()
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
        )
        writer.write(response.encode("latin1"))
        await writer.drain()

    async def _read_frame(self, reader):
        head = await reader.readexactly(2)
        b1, b2 = head
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        length = b2 & 0x7F
        if length == 126:
            length = struct.unpack("!H", await reader.readexactly(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", await reader.readexactly(8))[0]
        mask = await reader.readexactly(4) if masked else b""
        data = await reader.readexactly(length) if length else b""
        if masked:
            data = bytes(byte ^ mask[index % 4] for index, byte in enumerate(data))
        return opcode, data

    async def _send_frame(self, writer, opcode: int, data: bytes):
        length = len(data)
        frame = bytearray([0x80 | opcode])
        if length < 126:
            frame.append(length)
        elif length < 65536:
            frame.append(126)
            frame += struct.pack("!H", length)
        else:
            frame.append(127)
            frame += struct.pack("!Q", length)
        frame += data
        writer.write(bytes(frame))
        await writer.drain()

    async def _send_json(self, writer, data: dict[str, Any]):
        await self._send_frame(writer, 0x1, json.dumps(data).encode("utf-8"))

    async def _send_pong(self, writer, data: bytes):
        await self._send_frame(writer, 0xA, data)

    async def _handle_message(self, text: str, writer):
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            self.log("Invalid JSON message ignored.")
            await self._send_json(writer, {"type": "error", "message": "invalid_json"})
            return
        msg_type = message.get("type")
        if msg_type == "ping":
            await self._send_json(writer, {"type": "pong", "time": time.time()})
            return
        if msg_type == "tiktok_listener_stopped":
            self.log("TikTok listener stopped.")
            return
        if msg_type != "print_order":
            self.log(f"Unknown message type: {msg_type}")
            return
        payload = message.get("payload") or message.get("order") or message
        self.print_queue.put(payload)
        self.log(f"Queued print_order. Queue size: {self.print_queue.qsize()}")
        await self._send_json(writer, {"type": "print_queued", "queue": self.print_queue.qsize()})

    def _print_worker(self):
        while True:
            payload = self.print_queue.get()
            try:
                data = escpos_order(payload)
                self.printer.write_raw(data, payload.get("printerName"))
            except Exception as exc:
                self.log(f"Print failed: {exc}")
            finally:
                self.print_queue.task_done()

    def run(self):
        self._create_window()
        self.log("Ready. Click Start Server.")
        self.start_server()
        msg = wintypes.MSG()
        while self.user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
            self.user32.TranslateMessage(ctypes.byref(msg))
            self.user32.DispatchMessageW(ctypes.byref(msg))


if __name__ == "__main__":
    if socket.gethostname():
        SellerFlowHelper().run()
