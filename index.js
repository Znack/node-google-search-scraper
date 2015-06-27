var request = require('request');
var cheerio = require('cheerio');
var url     = require('url');

function search(options, callback) {

  var session = request.defaults({ jar : true });
  var host = options.host || 'www.google.com';
  var solver = options.solver;
  var params = options.params || {};
  var results = {
    foundPages: [],
  };	
  var currentResults;

  params.hl = params.hl || options.lang || 'en';

  if(options.age) params.tbs = 'qdr:' + options.age;
  if(options.query) params.q = options.query;

  params.start = 0;

  getPage(params, function onPage(err, body) {
    if(err) {
      if(err.code !== 'ECAPTCHA' || !solver) return callback(err);

      solveCaptcha(err.location, function(err, page) {
        if(err) return callback(err);
        onPage(null, page);
      });

      return;
    }

    if (
      body.indexOf("it's really you sending the requests, and not a robot") != -1 ||
      body.indexOf("but your computer or network may be sending automated queries") != -1
    ) {
      // we've got google captcha now
      return solver.solve();
    }

    if(options.extractResults && typeof options.extractResults === "function") {
      currentResults = options.extractResults(body);
    } else {
      currentResults = extractResults(body);
    }

    if (options.oneCallbackForAllResults) {
      callback(null, currentResults);
    } else {
      currentResults.foundPages.forEach(function(result) {
        callback(null, result);
      });
    }

    if(currentResults.foundPages.length === 0) {
      return;
    }

    results.foundPages = results.foundPages.concat(currentResults);

    if(!options.limit || results.length < options.limit) {
      params.start = results.length;
      getPage(params, onPage);
    }
  });


  function getPage(params, callback) {
    session.get({
        uri: 'http://' + host + '/search',
        qs: params,
        followRedirect: false
      }, 
      function(err, res) {

        if(err) return callback(err);

        if(res.statusCode === 302) {
          var err = new Error('Captcha');
          err.code = 'ECAPTCHA';
          err.location = res.headers.location;
          this.abort();
          return callback(err);
        }

        callback(null, res.body);
      }
    );
  }

  function extractResults(body) {
    var results = {
      foundPages: [],
    };
    var $ = cheerio.load(body);

    $('.g h3 a').each(function(i, elem) {
      var parsed = url.parse(elem.attribs.href, true);
      if (parsed.pathname === '/url') {
        results.foundPages.push(parsed.query.q);
      }
    });

    return results;
  }

  function solveCaptcha(captchaUrl, callback) {

    var tmp = url.parse(captchaUrl);
    var baseUrl = url.format({
      protocol: tmp.protocol,
      hostname: tmp.host,
    });

    // Fetch captcha page
    session.get(captchaUrl, function(err, res) {
      if(err) return callback(err);

      var $ = cheerio.load(res.body);
      var captchaId = $('input[name=id]').attr('value');
      var continueUrl = $('input[name=continue]').attr('value');
      var formAction = $('form').attr('action');
      var imgSrc = $('img').attr('src');

      // Fetch captcha image
      session.get({uri: baseUrl + imgSrc, encoding: null}, function(err, res) {
        if(err) return callback(err);

        // Send to solver
        solver.solve(res.body, function(err, id, solution) {
          if(err) return callback(err);

          // Try solution
          session.get({
              uri: baseUrl + '/sorry/' + formAction,
              qs: {
                id: captchaId,
                captcha: solution,
                continue: continueUrl
              }
            }, 
            function(err, res) {
              if(res.statusCode !== 200) return callback(new Error('Captcha decoding failed'));
              callback(null, res.body);
            }
          );

        });

      });

    });

  }

}

module.exports.search = search;
