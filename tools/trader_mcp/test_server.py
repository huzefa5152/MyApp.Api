"""Offline regression checks plus a real stdio MCP client/server handshake."""
import asyncio
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from server import TraderApi, QuoteLine, amount, build_server, validate_url
from login import protect


class FakeApi(TraderApi):
    def __init__(self, writes=False):
        super().__init__("http://127.0.0.1:1", "fake-local-test-token", [1], writes)
        self.revoked = False
        self.permission = True
        self.posts = 0
        self.requests = []

    async def request(self, method, path, **kwargs):
        self.requests.append((method, path))
        if self.revoked:
            raise ValueError("Revoked access")
        if path == "/api/companies/1":
            return {"id": 1, "name": "Sample Company"}
        if path == "/api/companies":
            return [{"id": 1, "name": "Sample Company", "fbrToken": "secret"}, {"id": 2, "name": "Other"}]
        if path == "/api/permissions/me":
            return {"permissions": ["salesquotes.manage.create"] if self.permission else []}
        if path == "/api/clients/company/1":
            return [{"id": 7, "companyId": 1, "name": "Sample Client", "ntn": "private"}]
        if path == "/api/invoices/8":
            return {"id": 8, "companyId": 2}
        if path == "/api/itemtypes/10":
            return {"id": 10, "companyId": 2}
        if path == "/api/salesquotes/company/1" and method == "POST":
            self.posts += 1
            return {"id": 99, "companyId": 1, "quoteNumber": 1}
        raise AssertionError("Unexpected test route")


async def result(mcp, name, args):
    value = await mcp.call_tool(name, args)
    if isinstance(value, tuple):
        return value[1]
    if isinstance(value, dict):
        return value
    return json.loads(value[0].text)


class ToolsTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.api = FakeApi(True)
        self.server = build_server(self.api)
        self.args = {"company_id": 1, "client_id": 7, "issue_date": "2026-01-01",
                     "gst_rate": "18", "lines": [{"description": "Sample item", "quantity": "1", "unit": "Pcs", "unit_price": "1.005"}]}

    async def test_default_tools_do_not_include_write(self):
        names = [t.name for t in await build_server(FakeApi()).list_tools()]
        self.assertEqual(len(names), 7)
        self.assertNotIn("create_quote", names)

    async def test_company_scope_and_secret_projection(self):
        data = await result(self.server, "list_companies", {})
        self.assertEqual(data, {"companies": [{"id": 1, "name": "Sample Company"}]})
        with self.assertRaises(Exception):
            await self.server.call_tool("get_stock", {"company_id": 2})
        self.assertNotIn(("GET", "/api/companies/2"), self.api.requests)

    async def test_client_identifiers_not_returned(self):
        data = await result(self.server, "search_clients", {"company_id": 1})
        self.assertNotIn("ntn", data["items"][0])

    async def test_foreign_invoice_refused(self):
        with self.assertRaises(Exception):
            await self.server.call_tool("get_invoice", {"company_id": 1, "invoice_id": 8})

    async def test_foreign_client_refused(self):
        with self.assertRaises(Exception):
            await self.server.call_tool("preview_quote", {**self.args, "client_id": 8})

    async def test_foreign_item_refused(self):
        args = {**self.args, "lines": [{**self.args["lines"][0], "item_type_id": 10}]}
        with self.assertRaises(Exception):
            await self.server.call_tool("preview_quote", args)

    async def test_preview_permission_and_revocation(self):
        self.api.permission = False
        with self.assertRaises(Exception):
            await self.server.call_tool("preview_quote", self.args)
        self.api.revoked = True
        with self.assertRaises(Exception):
            await self.server.call_tool("list_companies", {})

    async def test_preview_rounding_no_write(self):
        data = await result(self.server, "preview_quote", self.args)
        self.assertEqual((data["subtotal"], data["gstAmount"], data["grandTotal"]), ("1.00", "0.18", "1.18"))
        self.assertFalse(data["saved"])
        self.assertEqual(self.api.posts, 0)

    async def test_write_single_use_and_auto_numbering(self):
        data = await result(self.server, "preview_quote", self.args)
        await self.server.call_tool("create_quote", {"preview_id": data["previewId"]})
        with self.assertRaises(Exception):
            await self.server.call_tool("create_quote", {"preview_id": data["previewId"]})
        self.assertEqual(self.api.posts, 1)

    async def test_access_rechecked_before_write(self):
        data = await result(self.server, "preview_quote", self.args)
        self.api.revoked = True
        with self.assertRaises(Exception):
            await self.server.call_tool("create_quote", {"preview_id": data["previewId"]})
        self.assertEqual(self.api.posts, 0)

    async def test_expired_preview_no_write(self):
        data = await result(self.server, "preview_quote", self.args)
        with patch("server.time.monotonic", return_value=10**12):
            with self.assertRaises(Exception):
                await self.server.call_tool("create_quote", {"preview_id": data["previewId"]})
        self.assertEqual(self.api.posts, 0)

    async def test_protocol_initialize_discover_and_invalid_call(self):
        params = StdioServerParameters(command=sys.executable, args=[str(Path(__file__).with_name("server.py"))],
                                       env={**os.environ, "TRADER_MCP_API_URL": "http://127.0.0.1:1", "TRADER_MCP_TOKEN": "fake-local-token"})
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                info = await session.initialize()
                self.assertEqual(info.serverInfo.name, "Trader ERP")
                tools = await session.list_tools()
                self.assertEqual(len(tools.tools), 7)
                failure = await session.call_tool("get_invoice", {"company_id": -1, "invoice_id": 1})
                self.assertTrue(failure.isError)

    async def test_transport_denials_and_redirect_do_not_expose_body(self):
        original = httpx.AsyncClient
        for code in (401, 403, 404, 302, 500):
            transport = httpx.MockTransport(lambda request: httpx.Response(code, text="secret payload", headers={"Location": "https://other.example"}))
            with patch("server.httpx.AsyncClient", side_effect=lambda **kw: original(**kw, transport=transport)):
                with self.assertRaises(ValueError) as error:
                    await TraderApi("https://sample.example", "token").request("GET", "/api/companies")
                self.assertNotIn("secret", str(error.exception))


class ValidationTest(unittest.TestCase):
    def test_bad_origins(self):
        for value in ("http://remote.example", "https://user:pass@sample.example", "https://sample.example/path", "https://sample.example/?token=x"):
            with self.assertRaises(ValueError):
                validate_url(value)

    def test_invalid_numbers(self):
        for value in ("NaN", "Infinity", "-1", "1000000000", "0.0000000000001"):
            with self.assertRaises(ValueError):
                amount(value)

    def test_write_requires_allowlist(self):
        with self.assertRaises(ValueError):
            TraderApi("https://sample.example", "token", None, True)

    @unittest.skipUnless(os.name == "nt", "DPAPI is Windows only")
    def test_credential_encryption_roundtrip(self):
        encrypted = protect(b"fake-token")
        self.assertNotIn(b"fake-token", encrypted)
        self.assertEqual(protect(encrypted, decrypt=True), b"fake-token")


if __name__ == "__main__":
    unittest.main(verbosity=2)
