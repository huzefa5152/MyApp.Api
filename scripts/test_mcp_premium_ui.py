"""Public guide, premium notice and seed-only console at three viewport sizes."""
import argparse,json
from playwright.sync_api import sync_playwright,expect
from mcp_catalog_fixture import LocalCatalogFixture
p=argparse.ArgumentParser();p.add_argument('--base',default='http://localhost:5197');p.add_argument('--ui',default='http://127.0.0.1:5198');args=p.parse_args()
f=LocalCatalogFixture(args.base);assert args.ui.startswith(('http://localhost:','http://127.0.0.1:'))
checks=0
try:
    roles=f.require(*f.http('GET','/api/roles',f.admin));sales=next(r['id'] for r in roles if r['name']=='Sales Edition')
    companies=f.require(*f.http('GET','/api/companies',f.admin));uid,worker=f.user(f.admin,'ui',[sales],[companies[0]['id']])
    with sync_playwright() as pw:
        browser=pw.chromium.launch()
        for width in (375,768,1280):
            context=browser.new_context(viewport={'width':width,'height':900});page=context.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.route('**/env.js',lambda r:r.fulfill(body="window._env_={API_URL:'/api'};",content_type='text/javascript'))
            page.goto(args.ui+'/login');page.get_by_role('link',name='Connect ChatGPT, Claude or a coding agent',exact=False).click()
            expect(page.get_by_role('heading',name='Connect your AI assistant with MCP')).to_be_visible()
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('Array.from(document.querySelectorAll("*")).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})).slice(-12)')
            assert not errors,errors;checks+=1;print('PASS public guide '+str(width),flush=True)
            page.evaluate('(token)=>localStorage.setItem("token",token)',worker)
            page.goto(args.ui+'/profile?tab=mcp-connections')
            expect(page.get_by_text('Purchase this premium feature',exact=True)).to_be_visible(timeout=30000)
            assert page.get_by_role('tab',name='MCP Administration',exact=True).count()==0
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('Array.from(document.querySelectorAll("*")).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})).slice(-12)')
            assert not errors,errors;checks+=1;print('PASS denied user '+str(width),flush=True)
            page.evaluate('(token)=>localStorage.setItem("token",token)',f.admin)
            page.goto(args.ui+f'/profile?tab=mcp-catalog&userId={uid}')
            expect(page.get_by_text('Allow AI access',exact=False)).to_be_visible(timeout=30000)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), page.evaluate('Array.from(document.querySelectorAll("*")).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width})).slice(-12)')
            assert not errors,errors;checks+=1;print('PASS seed grant console '+str(width),flush=True)
            context.close()
        browser.close()
    print(f'{checks} MCP UI cases passed')
finally:f.cleanup()
