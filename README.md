# abigail.sh

this is the code behind [abigail.sh](https://abigail.sh).

if you are familiar with fastapi, or websites in general, you may think that this is a disgustingly over-engineered and unnecessary way to run a mostly static website, you would be correct. i wrote this website this way largely for fun, not for practical reasons; and you should probably not take inspiration from it.

you are free to browse the code, though pull requests are disabled for the general public as this is not a collaborative project.

self-hosting this is not recommended, is not supported, and will require you to reverse engineer the private submodule located at `src/abi/private`; which contains parts of the site that are either intentionally hidden, or cannot be shared under the CC-BY-NC-SA-4.0-INT license.

add my button to your site :3

![img](src/abi/public/images/button.png)

```html
<a href="https://abigail.sh">
    <img
        src="https://abigail.sh/static/images/button.png"
        width="88"
        height="31"
        loading="lazy"
        style="image-rendering:pixelated"
        alt="abigail.sh 88x31px web button"
    >
</a>
```