import { BadRequestError, type RequestContext } from '@azerothjs/http';

const NUL = /%00/;

export const wellFormed = (context: Pick<RequestContext, 'request'>) =>
{
    if (NUL.test(context.request.url))
    {
        throw new BadRequestError('That address is not one this server reads.');
    }
};
