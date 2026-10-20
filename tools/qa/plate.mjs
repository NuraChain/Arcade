/**
 * A person at a table can be pressed, and what is pressed is their plate.
 *
 * The plate is not the felt, so the press makes no move: the table underneath is at the revision
 * it was at. It opens the one sheet of what can be done about a person, which leads with their
 * profile. The reader's own plate is left out, because none of it is about themselves.
 *
 * `seated` is false for somebody watching, who has no plate of their own.
 *
 * The matrix holds the size of the press for a finger and the fit pass that nothing lies over it at
 * every size; this is the behaviour, asked once in each game because each dresses the plate itself.
 */
export async function platesPressed(record, page, who, seated = true)
{
    const read = async () => await page.evaluate(() =>
    {
        const box = (one) => one.getBoundingClientRect();
        const plates = [...document.querySelectorAll('main .table-stage .table-plate')].filter((one) => box(one).width > 1 && box(one).height > 1);

        return {
            rev: document.querySelector('main .table-stage')?.getAttribute('data-rev') ?? '',
            plates: plates.map((plate) =>
            {
                const press = plate.querySelector('.table-plate-press');
                const name = plate.querySelector('.table-plate-name')?.textContent?.trim() ?? '';

                if (press === null)
                {
                    return { name, says: null, fits: true, reached: true };
                }

                const [outer, inner] = [box(plate), box(press)];
                const hit = document.elementFromPoint(inner.left + inner.width / 2, inner.top + inner.height / 2);

                return {
                    name,
                    says: press.getAttribute('aria-label'),
                    fits: Math.abs(outer.width - inner.width) <= 3 && Math.abs(outer.height - inner.height) <= 3,
                    reached: hit === press
                };
            })
        };
    });

    const before = await read();
    const pressed = before.plates.filter((one) => one.says !== null);
    const left = before.plates.filter((one) => one.says === null).map((one) => one.name);

    record(`${ who } can press every plate at the table${ seated ? ' but their own' : '' }`,
        pressed.length > 0 && pressed.every((one) => one.says === `More about ${ one.name }`) && left.join() === (seated ? 'You' : ''),
        `${ pressed.length } to press, left out: ${ left.join(', ') || 'none' }`);
    record(`and each press ${ who } is given covers its plate, with nothing lying over it`,
        pressed.every((one) => one.fits && one.reached),
        pressed.filter((one) => !one.fits || !one.reached).map((one) => `${ one.name }${ one.fits ? '' : ' is not covered' }${ one.reached ? '' : ' is under something' }`).join(' · '));

    const sheet = page.locator('[role="dialog"][aria-label="More"]');
    const opened = await page.locator('main .table-stage .table-plate-press').first().click({ timeout: 4000 }).then(() => true, () => false)
        && await sheet.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
    const offered = opened ? (await sheet.locator('ul button').allTextContents()).map((one) => one.trim()) : [];
    const about = opened ? (await sheet.locator('header').textContent() ?? '') : '';

    record(`a press on one offers ${ who } what can be done about that person, their profile first`,
        opened && offered[0] === 'View profile' && offered[1] === 'Message' && pressed.length > 0 && about.includes(pressed[0].name),
        opened ? `${ offered.slice(0, 3).join(' · ') }, about ${ about.trim().slice(0, 40) }` : 'no sheet opened');

    if (opened)
    {
        await sheet.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 4000 }).catch(() => undefined);
    }

    const closed = await page.locator('[data-overlay-layer]').first().waitFor({ state: 'detached', timeout: 4000 }).then(() => true, () => false);
    const after = await read();

    record(`and it made no move for ${ who }: the sheet closes back to the table as it was`,
        closed && after.rev !== '' && after.rev === before.rev,
        `revision ${ before.rev || 'unknown' } to ${ after.rev || 'unknown' }${ closed ? '' : ', the sheet is still up' }`);
}

/**
 * A profile opened from a plate is left by the back arrow for the table it was opened from, and
 * that has to hold on a table that was RELOADED. The router stamps the first page opened after a
 * reload with the key of the page that was reloaded (the framework register, entry 41), the shell
 * once took the profile for the table it had just been on, counted no page in this visit, and the
 * arrow went to Friends, where a profile belongs, instead of back. A page opened by a link has no
 * stamp to collide with, so only a reload shows it.
 *
 * The pass that asks this must keep nothing in the page that a reload would lose.
 */
export async function backFromProfile(record, page, who)
{
    const table = new URL(page.url()).pathname;
    const press = page.locator('main .table-stage .table-plate-press').first();
    const sheet = page.locator('[role="dialog"][aria-label="More"]');

    await page.reload({ waitUntil: 'networkidle' });

    const opened = await press.click({ timeout: 8000 }).then(() => true, () => false)
        && await sheet.locator('ul button', { hasText: /^View profile$/ }).click({ timeout: 4000 }).then(() => true, () => false);
    const there = opened
        && await page.waitForFunction(() => location.pathname.startsWith('/app/people/'), null, { timeout: 5000 }).then(() => true, () => false);

    record(`${ who } is taken to the profile of the person pressed, from a table that has been reloaded`, there, new URL(page.url()).pathname);

    const back = there
        && await page.locator('button[aria-label="Back"]').first().click({ timeout: 4000 }).then(() => true, () => false)
        && await page.waitForFunction((path) => location.pathname === path, table, { timeout: 5000 }).then(() => true, () => false)
        && await page.locator('main .table-stage .table-plate').first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);

    record(`and the back arrow brings ${ who } back to the table, not to the page a profile belongs under`, back, new URL(page.url()).pathname);
}
