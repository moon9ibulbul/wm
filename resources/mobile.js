function toggleSidebar(el) {
    if (el.innerText == '<') {
        //close it
        el.innerText = '>'
        document.querySelector('.left').style.left = 'calc(-300px - 1em)'
        document.querySelector('.right').style.left = 0
    } else {
        //open it
        el.innerText = '<'
        document.querySelector('.left').style.left = 0
        document.querySelector('.right').style.left = 'calc(300px + 1em)'
    }
}
